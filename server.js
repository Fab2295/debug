import cds from "@sap/cds";

const INFO = cds.log("info");

cds.on("bootstrap", (app) => {
  INFO(`Iniciando o servidor`);
});

cds.on(`shutdown`, () => {
  INFO(`Servidor desligado/resetado`);
});
