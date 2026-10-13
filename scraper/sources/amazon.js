import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import {
  UAS_DESKTOP,
  headersNavegador,
  fetchComRetry,
  parsePrecoBR,
  decodificarEntidades,
  tituloRelevante,
  precoNaFaixa,
} from "../lib.js";

puppeteer.use(StealthPlugin());

let browserPromise;
function getBrowser() {
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

// Extrai título e preço da página de produto da Amazon. Função pura (testável).
export function parseAmazon(html) {
  if (/api-services-support@amazon\.com|Digite os caracteres|captcha/i.test(html) && !/productTitle/.test(html)) {
    return { erro: "bloqueado (captcha)" };
  }
  const titulo = decodificarEntidades((html.match(/<span id="productTitle"[^>]*>\s*([^<]+?)\s*</) || [])[1]);
  if (!titulo) return { erro: "página sem título de produto" };
  if (/atualmente indisponível/i.test(html)) return { titulo, indisponivel: true };

  // preferência: JSON embutido do bloco de preço; fallback: spans a-price
  let preco = null;
  const m = html.match(/"priceAmount":([\d.]+)/);
  if (m) preco = Number(m[1]);
  if (preco == null) {
    const core = html.split(/corePriceDisplay|corePrice_feature_div/)[1] ?? html;
    const inteiro = (core.match(/class="a-price-whole">([\d.,]+)/) || [])[1];
    const centavos = (core.match(/class="a-price-fraction">(\d{2})/) || [])[1] ?? "00";
    if (inteiro) preco = parsePrecoBR(`${inteiro},${centavos}`);
  }
  if (preco == null) return { titulo, erro: "preço não encontrado" };
  return { titulo, preco };
}

// Busca por palavra-chave (para pesquisa de mercado / comparação de marcas —
// diferente de `buscar`, que só rastreia UMA url de produto já conhecida).
// IMPORTANTE: os seletores abaixo foram escritos com base na estrutura pública
// conhecida da página de resultados da Amazon BR, mas não há fixture de teste
// (a Amazon bloqueia scraping automatizado de páginas de busca com frequência
// maior que páginas de produto) — se vier vazio, inspecione o HTML manualmente
// e ajuste os seletores/regex.
export function parseAmazonBusca(html) {
  if (/api-services-support@amazon\.com|Digite os caracteres|captcha/i.test(html)) {
    return { erro: "bloqueado (captcha)" };
  }
  const cards = html.split(/data-component-type="s-search-result"/).slice(1);
  if (cards.length === 0) return { erro: "nenhum card de resultado na página" };

  const anuncios = [];
  for (const card of cards) {
    const asin = (card.match(/data-asin="([A-Z0-9]{10})"/) || [])[1];
    const titulo = decodificarEntidades(
      (card.match(/<h2[^>]*>[\s\S]*?<span[^>]*>([^<]+)<\/span>/) || [])[1]
    );
    if (!asin || !titulo) continue;

    const inteiro = (card.match(/class="a-price-whole">([\d.,]+)/) || [])[1];
    const centavos = (card.match(/class="a-price-fraction">(\d{2})/) || [])[1] ?? "00";
    if (!inteiro) continue;
    const preco = parsePrecoBR(`${inteiro},${centavos}`);
    if (preco == null) continue;

    // ícone/badge "Prime" no card (aria-label="Amazon Prime" ou span a-icon-prime).
    // 2026-07-16: removido o slice(0,3000) — comparado com HAR real, o badge Prime
    // costuma aparecer entre 6000-9000 chars dentro do card (depois do preço), a
    // janela curta sempre dava falso negativo (prime:false em card com Prime de verdade).
    const prime = /a-icon-prime|aria-label="Amazon Prime"/i.test(card);
    anuncios.push({
      fonte: "amazon",
      loja: "Amazon",
      titulo,
      preco,
      prime,
      url: `https://www.amazon.com.br/dp/${asin}`,
    });
  }
  return { anuncios };
}

// Amazon no BR costuma ser a mais cara entre as fontes — usada aqui só como
// referência de teto de preço, não pra achar o melhor custo-benefício.
// `apenasPrime` filtra pra frete rápido Prime (equivalente ao "frete grátis"
// das outras fontes, já que a Amazon não tem um filtro de frete grátis solto).
//
// 2026-07-16: reescrito pra usar Puppeteer (igual à AliExpress) depois de
// confirmar via HAR real que fetch simples cai bloqueado (HTTP 503 / página
// de challenge) mesmo com headers de navegador — a Amazon exige uma sessão
// "aquecida" por JS que só um navegador de verdade resolve. `buscar()` acima
// (produto único, usado no pipeline de produção) continua via fetch porque
// já funcionava assim; só a busca por termo (pesquisa de mercado) precisava
// do navegador.
export async function buscarPorTermo(produto, { apenasPrime = true, limite = 5 } = {}) {
  const termo = produto.palavrasChave;
  const url = `https://www.amazon.com.br/s?k=${encodeURIComponent(termo)}`;

  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 1366, height: 900 });
    await page.setExtraHTTPHeaders({ "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7" });
    // "aquece" a sessão visitando a home antes da busca — ir direto pra URL de
    // busca num browser "frio" (sem cookies/sessão) cai numa página de
    // interstício vazia (~2KB, sem resultados), mesmo sem indício de captcha.
    await page.goto("https://www.amazon.com.br/", { waitUntil: "domcontentloaded", timeout: 45000 });
    await new Promise((r) => setTimeout(r, 1500));
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await new Promise((r) => setTimeout(r, 1500));

    const html = await page.content();
    const r = parseAmazonBusca(html);
    if (r.erro) return { erro: r.erro };

    const relevantes = r.anuncios
      .filter((a) => tituloRelevante(a.titulo, produto) && precoNaFaixa(a.preco, produto))
      .filter((a) => !apenasPrime || a.prime)
      .sort((a, b) => a.preco - b.preco)
      .slice(0, limite);
    return { ofertas: relevantes };
  } catch (e) {
    return { erro: e.message };
  } finally {
    await page.close();
  }
}

export async function buscar(produto) {
  if (!produto.amazonUrl) return { ofertas: [], pulada: true };
  const url = produto.amazonUrl.split("?")[0];
  // A Amazon bloqueia de forma intermitente: troca de user-agent a cada tentativa
  // (deslocando o índice por sorteio) e adiciona cabeçalhos de navegação real.
  const inicio = Math.floor(Math.random() * UAS_DESKTOP.length);
  const html = await fetchComRetry(url, {
    tentativas: 4,
    headers: (tentativa) => ({
      ...headersNavegador(UAS_DESKTOP[(inicio + tentativa) % UAS_DESKTOP.length]),
      Referer: "https://www.google.com/",
      "sec-ch-ua": '"Chromium";v="137", "Google Chrome";v="137", "Not/A)Brand";v="24"',
      "sec-ch-ua-mobile": "?0",
      "sec-fetch-site": "cross-site",
    }),
    validar: (h) => (parseAmazon(h).erro === "bloqueado (captcha)" ? "bloqueado (captcha)" : null),
  });
  const r = parseAmazon(html);
  if (r.erro) throw new Error(r.erro);
  if (r.indisponivel) return { ofertas: [] };
  return { ofertas: [{ fonte: "amazon", loja: "Amazon", titulo: r.titulo, preco: r.preco, url }] };
}
