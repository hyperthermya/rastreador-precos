import test from "node:test";
import assert from "node:assert/strict";
import { avaliarAlertas } from "../alert.js";

const produto = { id: "p1", nome: "Produto 1", precoAlvo: 1599 };
const latestCom = (preco) => ({ produtos: { p1: { melhorOferta: { preco, fonte: "ml", loja: "ML", url: "x" } } } });

test("primeira rodada: registra mínimo histórico sem alertar por mínimo", () => {
  const { alertas, novoState } = avaliarAlertas([produto], latestCom(1709), {});
  assert.equal(alertas.length, 0);
  assert.equal(novoState.p1.menorHistorico, 1709);
});

test("preço-alvo atingido dispara alerta", () => {
  const { alertas } = avaliarAlertas([produto], latestCom(1590), { p1: { menorHistorico: 1709 } });
  assert.equal(alertas.length, 1);
  assert.match(alertas[0].motivos.join(";"), /preço-alvo/);
});

test("mesmo preço já alertado não repete email", () => {
  const state = { p1: { menorHistorico: 1590, ultimoAlertaPreco: 1590 } };
  const { alertas } = avaliarAlertas([produto], latestCom(1590), state);
  assert.equal(alertas.length, 0);
});

test("queda >=2% abaixo do mínimo histórico alerta mesmo acima do alvo", () => {
  const { alertas, novoState } = avaliarAlertas([produto], latestCom(1650), { p1: { menorHistorico: 1709 } });
  assert.equal(alertas.length, 1);
  assert.match(alertas[0].motivos.join(";"), /menor preço histórico/);
  assert.equal(novoState.p1.menorHistorico, 1650);
});

test("queda pequena (<2%) não alerta, mas atualiza o mínimo", () => {
  const { alertas, novoState } = avaliarAlertas([produto], latestCom(1700), { p1: { menorHistorico: 1709 } });
  assert.equal(alertas.length, 0);
  assert.equal(novoState.p1.menorHistorico, 1700);
});
