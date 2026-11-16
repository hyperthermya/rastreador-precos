// Orquestrador separado do `index.js`: roda só a fonte AliExpress (headless,
// mais pesada e lenta) para os produtos marcados com `aliexpress: true` em
// products.json, e grava em docs/data/aliexpress.json — não mistura com o
// pipeline de 3h (index.js) nem com o sistema de alertas.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buscar, fecharBrowser } from "./sources/aliexpress.js";

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(raiz, "docs", "data");

async function main() {
  const agora = new Date().toISOString();
  const { products } = JSON.parse(fs.readFileSync(path.join(raiz, "products.json"), "utf8"));
  const alvos = products.filter((p) => p.aliexpress === true);

  if (alvos.length === 0) {
    console.log("Nenhum produto com \"aliexpress\": true em products.json — nada a fazer.");
    return;
  }

  const resultado = { geradoEm: agora, produtos: {} };
  // coleta anterior: se esta rodada vier vazia/com erro (ex.: o runner do GitHub é bloqueado ou vê
  // outro catálogo), mantém os anúncios da última coleta boa marcados como desatualizados
  let anterior = {};
  try { anterior = JSON.parse(fs.readFileSync(path.join(dataDir, "aliexpress.json"), "utf8")).produtos ?? {}; } catch {}
  for (const produto of alvos) {
    console.log(`Coletando (AliExpress): ${produto.nome}`);
    const r = await buscar(produto);
    const antigas = (anterior[produto.id]?.ofertas ?? []).map((o) => ({ ...o, desatualizado: true }));
    const emAntiga = anterior[produto.id]?.em;
    if (r.erro) {
      console.error(`  falhou: ${r.erro}`);
      resultado.produtos[produto.id] = { ok: false, erro: r.erro, em: emAntiga ?? agora, ofertas: antigas };
    } else if (r.ofertas.length === 0 && antigas.length > 0) {
      console.log(`  0 oferta(s) agora; mantendo ${antigas.length} da coleta anterior (desatualizadas)`);
      resultado.produtos[produto.id] = { ok: true, em: emAntiga ?? agora, ofertas: antigas };
    } else {
      console.log(`  ${r.ofertas.length} oferta(s) relevante(s)`);
      resultado.produtos[produto.id] = { ok: true, em: agora, ofertas: r.ofertas };
    }
  }

  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(dataDir, "aliexpress.json"), JSON.stringify(resultado, null, 1));
  console.log("Rodada AliExpress concluída.");
}

main()
  .catch((e) => {
    console.error("Falha fatal na rodada AliExpress:", e);
    process.exitCode = 1;
  })
  .finally(() => fecharBrowser());
