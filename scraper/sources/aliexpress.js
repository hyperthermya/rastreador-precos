// Coletor do AliExpress via navegador headless (Puppeteer + stealth).
//
// Diferente das outras fontes (fetch simples + regex), a busca do AliExpress
// tem proteção anti-bot ativa (fetch simples cai numa página de "punição") —
// por isso essa fonte roda separada (`aliexpress-run.mjs`, workflow diário),
// não a cada 3h junto com o restante em `index.js`.
//
// 2026-07-16: reescrito depois de analisar um HAR de navegação real. Duas
// correções importantes descobertas ali:
//   1. A URL de busca certa é `/w/wholesale-<slug-com-tracos>.html`, não
//      `/wholesale?SearchText=...` (a antiga sempre batia na página de
//      punição, então os "seletores desatualizados" nunca eram o problema
//      real — a URL é que estava errada).
//   2. Os resultados vêm embutidos como JSON no próprio HTML inicial, em
//      `window._dida_config_._init_data_` (campo `itemList.content[]`, cada
//      item com `productId`, `title.displayTitle`, `prices.salePrice.minPrice`).
//      Isso é muito mais estável que depender de classes CSS (`multi--...`)
//      que mudam a cada redesign do site.
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { normalizar } from "../lib.js";

puppeteer.use(StealthPlugin());

let browserPromise;
function getBrowser() {
  // reaproveita o mesmo navegador entre produtos da mesma rodada (mais rápido, menos memória)
  browserPromise ??= puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  return browserPromise;
}

export async function fecharBrowser() {
  if (browserPromise) {
    const b = await browserPromise;
    await b.close();
    browserPromise = undefined;
  }
}

function tituloRelevanteAli(titulo, produto) {
  const t = normalizar(titulo);
  const obrigOk = (produto.termosObrigatorios ?? []).every((termo) =>
    Array.isArray(termo) ? termo.some((alt) => t.includes(normalizar(alt))) : t.includes(normalizar(termo))
  );
  const proibOk = !(produto.termosProibidos ?? []).some((termo) => t.includes(normalizar(termo)));
  return obrigOk && proibOk;
}

// Extrai productId + título + preço mínimo do JSON embutido no HTML da busca.
// Função pura (testável) — não depende de seletor CSS, só da chave JSON.
export function parseAliExpress(html) {
  if (!html.includes("_dida_config_")) {
    return { erro: "página bloqueada (anti-bot) ou fora do padrão esperado" };
  }
  const regex =
    /"productId":"(\d+)"[\s\S]{0,200}?"displayTitle":"([^"]+)"[\s\S]{0,300}?"minPrice":([\d.]+)/g;
  const anuncios = [];
  const vistos = new Set();
  for (const m of html.matchAll(regex)) {
    const [, productId, titulo, precoStr] = m;
    if (vistos.has(productId)) continue;
    vistos.add(productId);
    const preco = Number(precoStr);
    if (!Number.isFinite(preco)) continue;
    anuncios.push({
      fonte: "aliexpress",
      loja: "AliExpress",
      titulo,
      preco,
      url: `https://pt.aliexpress.com/item/${productId}.html`,
    });
  }
  if (anuncios.length === 0) return { erro: "nenhum produto encontrado no JSON embutido da página" };
  return { anuncios };
}

// slug no formato que a URL /w/wholesale-<slug>.html espera: minúsculo,
// espaços e caracteres especiais viram hífen.
function paraSlug(termo) {
  return normalizar(termo)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// `produto.aliexpressBusca` (opcional) sobrescreve `palavrasChave` quando o termo em
// português não existe no catálogo do AliExpress (ex.: peças de e-bike em inglês/chinês).
export async function buscar(produto, { timeoutMs = 45000, freteGratis = false, limite = 5 } = {}) {
  const termo = produto.aliexpressBusca ?? produto.palavrasChave;
  const slug = paraSlug(termo);
  const sufixoFrete = freteGratis ? "?g=y" : "";
  const url = `https://pt.aliexpress.com/w/wholesale-${slug}.html${sufixoFrete}`;

  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1366, height: 900 });
    await page.setExtraHTTPHeaders({ "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7" });
    // "aquece" a sessão visitando a home antes da busca — um fetch/navegação
    // direta pra URL de busca sem isso cai na página de bloqueio anti-bot
    // (confirmado comparando com HAR de navegação real: cookies como
    // `xman_us_f` só existem depois de passar pela home).
    await page.goto("https://pt.aliexpress.com/", { waitUntil: "domcontentloaded", timeout: timeoutMs });
    await new Promise((r) => setTimeout(r, 1500));
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    // dá um tempo pro _dida_config_ terminar de montar (mesmo sendo SSR, alguns
    // campos são hidratados/ajustados por JS logo após o DOM inicial)
    await new Promise((r) => setTimeout(r, 1500));

    const html = await page.content();
    const r = parseAliExpress(html);
    if (r.erro) return { erro: r.erro };

    const relevantes = r.anuncios
      .filter((o) => tituloRelevanteAli(o.titulo, produto))
      .filter((o) => o.preco >= (produto.precoMin ?? 0) && o.preco <= (produto.precoMax ?? Infinity))
      .sort((a, b) => a.preco - b.preco)
      .slice(0, limite);

    return { ofertas: relevantes };
  } catch (e) {
    return { erro: e.message };
  } finally {
    await page.close();
  }
}
