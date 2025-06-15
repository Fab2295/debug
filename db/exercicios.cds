namespace accenture.treinamento.db;

using {
    managed,
    cuid
} from '@sap/cds/common';


entity Pessoas : managed {
    key cpf              : String(11);
        nome             : String(100);
        idade            : Integer;
        registroAprovado : Boolean;
        enderecos        : Composition of many Enderecos
                               on enderecos.ID = $self;
}


entity Enderecos {
    key ID     : Association to Pessoas;
    key CEP    : String(8);
        uf     : String(2);
        cidade : String(255);
        rua    : String(255);
}

context log {
    entity LogDelecoes : cuid {
        cpf      : type of Pessoas : cpf @assert.notNull;
        dataHora : DateTime              @cds.on.insert: $now;
    }
}
