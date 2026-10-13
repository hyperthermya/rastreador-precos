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
  for (const produto of alvos) {
    console.log(`Coletando (AliExpress): ${produto.nome}`);
    const r = await buscar(produto);
    if (r.erro) {
      console.error(`  falhou: ${r.erro}`);
      resultado.produtos[produto.id] = { ok: false, erro: r.erro, em: agora, ofertas: [] };
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
