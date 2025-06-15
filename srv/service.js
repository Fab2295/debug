import cds from "@sap/cds";

const INFO = cds.log("info");
const ERROR = cds.log("error");

export class CadastroPessoas extends cds.ApplicationService {
  async init() {
    const { Pessoas } = this.entities;

    INFO(`Iniciando o custom Handler do serviço CadastroPessoas`);

    // Conectando ao serviço externo BrasilAPI
    const BrasilAPI = await cds.connect.to("Brasil.API");

    this.prepend(() => {
      //garantindo que vai rodar antes de qualquer outro before na entidade Pessoas
      this.before(["CREATE", "UPDATE"], Pessoas, this.validarDados);
    });

    this.before(["CREATE", "UPDATE"], Pessoas, async (req) => {
      return await this.consultarApiCep(req, BrasilAPI);
    });

    //SOLUÇÃO DO DESAFIO
    this.before("DELETE", Pessoas, (req) => {
      req.on("succeeded", async () => {
        await this.criarLogDelecoes(req);
      });
    });

    this.on("hasAddress", Pessoas, async (req) => {
      return await this.validarEndereco(
        req.data.cpf || req.params[0].cpf,
        Pessoas
      );
    });

    this.on("bulkDeleteClients", async (req) => {
      return await this.deletarCadastros(req);
    });

    this.on("getClientsByAge", async (req) => {
      return await this.selecionarPessoasPorIdade(req);
    });

    //tratamento de msgs de erros
    this.on("error", (error, req) => {
      switch (error.message) {
        case "ENTITY_ALREADY_EXISTS":
          error.message = cds.i18n.messages.at(
            "ERROR_ENTITY_ALREADY_EXISTS",
            req.locale
          );
          break;

        default:
          break;
      }
    });

    return super.init();
  }

  /**
   * Consulta os endereços da lista de entrada na API BrasilAPI para obter detalhes de estado, cidade e rua com base no CEP.
   * Caso ocorra erro na API externa, rejeita a requisição com o status e mensagem apropriados.
   *
   * @async
   * @param {Object} req - Objeto da requisição CAP contendo os dados enviados pelo cliente.
   * @param {Object} req.data - Objeto contendo uma lista de endereços com CEPs.
   * @param {Object} BrasilAPI - Serviço externo conectado via cds.connect.to que permite realizar chamadas REST para a BrasilAPI.
   * @returns {Promise<void>}
   */
  async consultarApiCep(req, BrasilAPI) {
    const { enderecos } = req.data;

    if (!enderecos) {
      INFO(`Nenhum endereço fornecido na requisição`);
      return;
    }

    for (let i = 0; i < enderecos.length; i++) {
      const cep = enderecos[i].CEP; // Captura o cep do item

      INFO(`Consultando CEP: ${cep}`);

      try {
        const {
          state: uf,
          city: cidade,
          street: rua,
        } = await BrasilAPI.get(`/cep/v1/${cep}`);

        INFO(
          `Dados do CEP ${cep} obtidos com sucesso: Estado: ${uf}, Cidade: ${cidade}, Rua: ${rua}`
        );

        enderecos[i] = {
          ...enderecos[i],
          uf,
          cidade,
          rua,
        };
      } catch (error) {
        ERROR(`Erro ao consultar CEP ${cep}: ${error.message}`);
        ERROR(error);
        req.reject(
          error.statusCode || 500,
          error.message || cds.i18n.messages.at("ERROR_API_CEP", req.locale)
        );
      }
    }
  }

  /**
   * Valida os dados da requisição verificando as regras de idade mínima e formato de CPF.
   * Caso a validação falhe, dispara erro via req.error com mensagens internacionalizadas.
   *
   * @param {Object} req - Objeto da requisição CAP contendo os dados enviados pelo cliente.
   * @param {Object} req.data - Objeto contendo os campos a serem validados, como cpf e idade.
   * @throws {Error} Gera erro 400 caso os dados sejam inválidos (idade < 16 ou CPF inválido).
   */
  validarDados(req) {
    const { cpf, idade } = req.data;

    INFO(`Validando dados de entrada`);

    if (idade && idade < 16) {
      req.error(400, cds.i18n.messages.at("ERROR_WRONG_YEAR", req.locale));
    }

    if (cpf && !this.validarCPF(cpf)) {
      req.error(400, cds.i18n.messages.at("ERROR_WRONG_CPF", req.locale));
    }
  }

  /**
   * Valida o número de CPF verificando o tamanho, repetição de dígitos e os dois dígitos verificadores.
   *
   * @param {string} cpf - CPF a ser validado, apenas os 11 dígitos numéricos.
   * @returns {boolean} Retorna true se o CPF for válido, caso contrário false.
   */
  validarCPF(cpf) {
    if (typeof cpf !== "string") return false;

    if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) {
      ERROR(`CPF inválido: ${cpf}`);
      return false; // Rejeita CPFs com todos os dígitos iguais ou com tamanho diferente de 11
    }

    let soma = 0;
    let resto;

    // Validação do primeiro dígito verificador
    for (let i = 1; i <= 9; i++) {
      soma += parseInt(cpf.substring(i - 1, i)) * (11 - i);
    }
    resto = (soma * 10) % 11;
    if (resto === 10 || resto === 11) resto = 0;
    if (resto !== parseInt(cpf.substring(9, 10))) {
      return false;
    }

    // Validação do segundo dígito verificador
    soma = 0;
    for (let i = 1; i <= 10; i++) {
      soma += parseInt(cpf.substring(i - 1, i)) * (12 - i);
    }
    resto = (soma * 10) % 11;
    if (resto === 10 || resto === 11) resto = 0;
    if (resto !== parseInt(cpf.substring(10, 11))) {
      return false;
    }

    return true;
  }

  /**
   * Valida se a pessoa com o CPF informado possui um endereço cadastrado com CEP preenchido.
   *
   * Esta função executa uma consulta na entidade Pessoas, buscando o CPF e o CEP do endereço associado.
   * Retorna `true` apenas se encontrar um registro de endereço com o campo CEP preenchido.
   *
   * @async
   * @param {string} cpf - CPF da pessoa a ser validada.
   * @param {object} Pessoas - Entidade CDS representando a tabela de Pessoas.
   *                           Normalmente obtida via `this.entities.Pessoas`.
   * @returns {Promise<boolean>} Retorna `true` se houver um endereço com CEP, ou `false` caso contrário (incluindo erro na consulta).
   *
   **/
  async validarEndereco(cpf, Pessoas) {
    try {
      const endereco = await SELECT.one
        .from(Pessoas)
        .columns("cpf", "enderecos.CEP as cep")
        .where({
          cpf: cpf,
        });

      if (endereco && endereco.cep) {
        return true;
      }
    } catch (error) {
      ERROR(`Erro ao consultar endereço: ${error.message}`);
      ERROR(error);
      return false; // Se ocorrer erro na consulta, assume que não há endereço
    }

    return false;
  }

  /**
   * Cria um registro de log para exclusões, armazenando o CPF da pessoa afetada.
   *
   * Este método inicia uma transação (`cds.tx`) para garantir que o log de deleções
   * seja gravado de forma consistente na tabela `log.LogDelecoes`.
   *
   *
   * @param {Object} req - Objeto de requisição CAP contendo os dados da operação.
   *                                                         Espera-se que `req.data` contenha ao menos a propriedade `cpf`.
   * @returns {Promise<void>} Não retorna nada explicitamente, apenas grava o log na tabela.
   *
   * @example
   * await this.criarLogDelecoes(req);
   */
  async criarLogDelecoes(req) {
    await cds.tx(async (tx) => {
      const logDelecoes = cds.entities["log.LogDelecoes"];

      await tx.run(
        INSERT.into(logDelecoes).entries({
          cpf: req.data.cpf,
        })
      );
    });
  }

  /**
   * Deleta cadastros de pessoas com base em uma lista de CPFs.
   *
   * Para cada CPF fornecido:
   * - Verifica se o CPF existe.
   * - Verifica se há endereço cadastrado (não permite deletar se houver).
   * - Tenta realizar a exclusão.
   * - Retorna um array de resultados contendo mensagens de sucesso ou erro para cada CPF.
   *
   * @async
   * @param {Object} param - Parâmetro contendo informações da requisição.
   * @param {string} param.locale - Localidade para mensagens de retorno.
   * @param {Object} param.data - Dados da requisição.
   * @param {string[]} param.data.cpfs - Lista de CPFs a serem excluídos.
   * @returns {Promise<Object[]>} Lista de objetos com o CPF e a mensagem de resultado (sucesso ou erro).
   */
  async deletarCadastros({ locale, data: { cpfs } }) {
    const result = [];
    for (const cpf of cpfs) {
      INFO(`Iniciando exclusão do CPF: ${cpf}`);

      if (!(await this.checarCPFExiste(cpf))) {
        ERROR(`CPF ${cpf} não encontrado.`);
        result.push({
          cpf: cpf,
          message: cds.i18n.messages.at("ERROR_CPF_NOT_FOUND", locale),
        });
        continue;
      }

      // Verifica se o CPF tem endereço cadastrado
      const hasAddress = await this.validarEndereco(
        cpf,
        cds.entities("CadastroPessoas").Pessoas
      );

      if (hasAddress) {
        ERROR(`CPF ${cpf} possui endereço cadastrado.`);
        result.push({
          cpf: cpf,
          message: cds.i18n.messages.at("ERROR_HAS_ADDRESS", locale),
        });
        continue;
      }

      // Realiza a exclusão do registro
      try {
        await DELETE.from(Pessoas).where({ cpf: cpf });

        INFO(`CPF ${cpf} excluído com sucesso.`);
        result.push({
          cpf: cpf,
          message: cds.i18n.messages.at("SUCCESS_DELETE", locale),
        });
      } catch (error) {
        ERROR(`Erro ao excluir CPF ${cpf}: ${error.message}`);
        result.push({
          cpf: cpf,
          message:
            error.message ||
            cds.i18n.messages.at("ERROR_DELETE_FAILED", locale),
        });
      }
    }

    return result;
  }

  /**
   * Verifica se um CPF existe na tabela de Pessoas.
   *
   * Realiza um `SELECT` para verificar se há registro para o CPF informado.
   *
   * @async
   * @param {string} cpf - CPF a ser verificado.
   * @returns {Promise<boolean>} Retorna `true` se o CPF existir, caso contrário, `false`.
   */
  async checarCPFExiste(cpf) {
    const Pessoas = cds.entities("CadastroPessoas").Pessoas;

    try {
      const result = await SELECT.one.from(Pessoas).where({ cpf: cpf });

      return result ? true : false;
    } catch (error) {
      ERROR(`Erro ao verificar CPF ${cpf}: ${error.message}`);
      return false; // Se ocorrer erro na consulta, assume que o CPF não existe
    }
  }

  /**
   * Retorna uma lista de pessoas cuja idade seja maior ou igual à informada.
   *
   * Realiza uma consulta na tabela de Pessoas, aplicando filtro por idade mínima
   * e ordenando os resultados pela idade.
   *
   * @async
   * @param {import('@sap/cds/apis/services').Request} req - Objeto de requisição CAP contendo o campo `idade` em `req.data`.
   * @returns {Promise<Object[]>} Lista de pessoas com idade maior ou igual ao valor especificado.
   */
  async selecionarPessoasPorIdade(req) {
    const { idade } = req.data;

    INFO(`Buscando pessoas maiores ou igual a ${idade}`);

    return await SELECT.from(cds.entities("CadastroPessoas").Pessoas)
      .where({ idade: { ">=": idade } })
      .orderBy("idade");
  }
}
