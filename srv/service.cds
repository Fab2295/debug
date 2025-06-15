using {accenture.treinamento.db as db} from '../db/exercicios';

@path: 'CadastroPessoas'
service CadastroPessoas {
    entity Pessoas as
        projection on db.Pessoas
        excluding {
            registroAprovado,
            createdAt,
            createdBy,
            modifiedAt,
            modifiedBy
        }
        actions {
            function hasAddress()      returns Boolean;
            action   aprovarCadastro() returns Boolean;
        };

    action   bulkDeleteClients(cpfs : array of Pessoas : cpf @mandatory ) returns array of {
        cpf                                            : Pessoas : cpf;
        message                                        : String(50)
    };

    function getClientsByAge(idade : Integer)                             returns array of Pessoas;
}
