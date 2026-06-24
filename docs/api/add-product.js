// Função serverless do Vercel: adiciona um produto ao products.json do repositório
// via API do GitHub e dispara uma coleta imediata. Protegida por senha (ADD_PASSWORD).
// Sem dependências externas — usa fetch nativo (Node 18+).

const OWNER = "leomerets-prog";
const REPO = "rastreador-precos";
const BRANCH = "main";
const GH = "https://api.github.com";

function slug(s) {
  return (s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
}

function ghHeaders(token) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "User-Agent": "rastreador-precos",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ erro: "método não permitido" });
    return;
  }
  const token = process.env.GITHUB_TOKEN;
  const senhaCerta = process.env.ADD_PASSWORD;
  if (!token || !senhaCerta) {
    res.status(500).json({ erro: "servidor sem GITHUB_TOKEN/ADD_PASSWORD configurados" });
    return;
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }
  body = body || {};

  if (body.senha !== senhaCerta) {
    res.status(401).json({ erro: "senha incorreta" });
    return;
  }

  const nome = String(body.nome || "").trim();
  const precoAlvo = Number(body.precoAlvo);
  if (!nome || !Number.isFinite(precoAlvo) || precoAlvo <= 0) {
    res.status(400).json({ erro: "informe ao menos nome e um preço-alvo válido" });
    return;
  }

  const palavrasChave = String(body.palavrasChave || nome).trim();
  const termosObrigatorios = String(body.termosObrigatorios || "")
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  const termosProibidos = String(body.termosProibidos || "")
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  const precoMin = Number.isFinite(Number(body.precoMin)) && Number(body.precoMin) > 0
    ? Number(body.precoMin)
    : Math.round(precoAlvo * 0.5);
  const precoMax = Number.isFinite(Number(body.precoMax)) && Number(body.precoMax) > 0
    ? Number(body.precoMax)
    : Math.round(precoAlvo * 1.8);
  const amazonUrl = String(body.amazonUrl || "").trim();

  try {
    // 1. lê o products.json atual (conteúdo + sha)
    const getResp = await fetch(`${GH}/repos/${OWNER}/${REPO}/contents/products.json?ref=${BRANCH}`, {
      headers: ghHeaders(token),
    });
    if (!getResp.ok) throw new Error(`GitHub GET ${getResp.status}: ${await getResp.text()}`);
    const arquivo = await getResp.json();
    const atual = JSON.parse(Buffer.from(arquivo.content, "base64").toString("utf8"));
    const lista = Array.isArray(atual.products) ? atual.products : [];

    // 2. id único
    let id = slug(nome) || `produto-${Date.now()}`;
    if (lista.some((p) => p.id === id)) id = `${id}-${Date.now().toString(36).slice(-4)}`;

    const novo = { id, nome, palavrasChave };
    if (termosObrigatorios.length) novo.termosObrigatorios = termosObrigatorios;
    if (termosProibidos.length) novo.termosProibidos = termosProibidos;
    novo.precoAlvo = precoAlvo;
    novo.precoMin = precoMin;
    novo.precoMax = precoMax;
    if (amazonUrl) novo.amazonUrl = amazonUrl;
    lista.push(novo);

    // 3. grava de volta (commit)
    const conteudo = Buffer.from(JSON.stringify({ products: lista }, null, 2) + "\n", "utf8").toString("base64");
    const putResp = await fetch(`${GH}/repos/${OWNER}/${REPO}/contents/products.json`, {
      method: "PUT",
      headers: ghHeaders(token),
      body: JSON.stringify({
        message: `produto: adiciona ${nome}`,
        content: conteudo,
        sha: arquivo.sha,
        branch: BRANCH,
      }),
    });
    if (!putResp.ok) throw new Error(`GitHub PUT ${putResp.status}: ${await putResp.text()}`);

    // 4. dispara coleta imediata (melhor-esforço; não falha a requisição se não rolar)
    let coletaDisparada = false;
    try {
      const disp = await fetch(`${GH}/repos/${OWNER}/${REPO}/actions/workflows/track.yml/dispatches`, {
        method: "POST",
        headers: ghHeaders(token),
        body: JSON.stringify({ ref: BRANCH }),
      });
      coletaDisparada = disp.ok;
    } catch {
      /* ignora */
    }

    res.status(200).json({ ok: true, id, coletaDisparada });
  } catch (e) {
    res.status(502).json({ erro: String(e.message || e) });
  }
};
