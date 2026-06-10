import { UAS_DESKTOP, headersNavegador, fetchComRetry, parsePrecoBR, tituloRelevante } from "../lib.js";

// Extrai os deals do JSON-LD "feed-schema" das páginas de listagem do Pelando.
// Função pura (testável). Preço é opcional — nem sempre está no feed.
export function parsePelando(html) {
  const m = html.match(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return { erro: "feed-schema (JSON-LD) não encontrado" };
  let feed;
  try {
    feed = JSON.parse(m[1]);
  } catch {
    return { erro: "JSON-LD inválido" };
  }
  const partes = feed.mainEntity?.hasPart ?? [];
  if (!Array.isArray(partes) || partes.length === 0) return { erro: "feed-schema sem deals" };

  const deals = partes
    .filter((p) => p?.url && p?.name)
    .map((p) => {
      // tenta achar um "R$ ..." no HTML perto do link do deal (melhor esforço)
      let preco = null;
      const slug = p.url.split("/d/")[1];
      if (slug) {
        const i = html.indexOf(`/d/${slug}`, html.indexOf("</head>"));
        if (i !== -1) {
          const vizinhanca = html.slice(i, i + 3000);
          const pm = vizinhanca.match(/R\$\s?([\d.]+(?:,\d{2})?)/);
          if (pm) preco = parsePrecoBR(pm[1]);
        }
      }
      return { fonte: "pelando", titulo: p.name, url: p.url, preco };
    });
  return { deals };
}

export async function buscar(produto) {
  const paginas = ["https://www.pelando.com.br/recentes", "https://www.pelando.com.br/mais-quentes"];
  const todos = [];
  const erros = [];
  for (const url of paginas) {
    try {
      const html = await fetchComRetry(url, { headers: headersNavegador(UAS_DESKTOP[0]), tentativas: 2 });
      const r = parsePelando(html);
      if (r.erro) erros.push(`${url}: ${r.erro}`);
      else todos.push(...r.deals);
    } catch (e) {
      erros.push(`${url}: ${e.message}`);
    }
  }
  if (todos.length === 0 && erros.length > 0) throw new Error(erros.join("; "));

  const vistos = new Set();
  const promocoes = [];
  for (const d of todos) {
    if (vistos.has(d.url) || !tituloRelevante(d.titulo, produto)) continue;
    vistos.add(d.url);
    promocoes.push(d);
  }
  return { promocoes };
}
