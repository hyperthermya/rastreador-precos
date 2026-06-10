// Regras de alerta + envio de email via Resend.
// Estado por produto: { menorHistorico, ultimoAlertaPreco, ultimoAlertaEm }

// Decide quais alertas disparar. Função pura (testável).
export function avaliarAlertas(produtos, latest, state) {
  const alertas = [];
  const novoState = structuredClone(state);

  for (const produto of produtos) {
    const melhor = latest.produtos?.[produto.id]?.melhorOferta;
    if (!melhor || melhor.preco == null) continue;
    const s = (novoState[produto.id] ??= {});
    const motivos = [];

    if (s.menorHistorico == null || melhor.preco <= s.menorHistorico * 0.98) {
      if (s.menorHistorico != null) motivos.push(`novo menor preço histórico (antes R$ ${s.menorHistorico.toFixed(2)})`);
    }
    if (
      melhor.preco <= produto.precoAlvo &&
      (s.ultimoAlertaPreco == null || melhor.preco < s.ultimoAlertaPreco - 1)
    ) {
      motivos.push(`atingiu o preço-alvo de R$ ${produto.precoAlvo.toFixed(2)}`);
    }

    // mínimo histórico é atualizado sempre, alertando ou não
    if (s.menorHistorico == null || melhor.preco < s.menorHistorico) s.menorHistorico = melhor.preco;

    if (motivos.length > 0) alertas.push({ produto, melhor, motivos });
  }
  return { alertas, novoState };
}

async function enviarEmail(apiKey, destinatario, alerta, dashboardUrl) {
  const { produto, melhor, motivos } = alerta;
  const linhas = [
    `<h2>${produto.nome}</h2>`,
    `<p style="font-size:1.4em"><strong>R$ ${melhor.preco.toFixed(2).replace(".", ",")}</strong> em ${melhor.loja ?? melhor.fonte}</p>`,
    `<p>${motivos.join(" e ")}.</p>`,
    melhor.cupom ? `<p>Cupom: <strong>${melhor.cupom}</strong></p>` : "",
    `<p><a href="${melhor.url}">Ver oferta</a>${dashboardUrl ? ` · <a href="${dashboardUrl}">Abrir dashboard</a>` : ""}</p>`,
  ];
  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "Rastreador de Preços <onboarding@resend.dev>",
      to: [destinatario],
      subject: `💸 ${produto.nome} por R$ ${melhor.preco.toFixed(2).replace(".", ",")}`,
      html: linhas.join("\n"),
    }),
  });
  if (!resp.ok) throw new Error(`Resend HTTP ${resp.status}: ${await resp.text()}`);
}

// Avalia e envia. Só registra o alerta no state se o email saiu com sucesso,
// para reenviar na próxima rodada em caso de falha.
export async function processarAlertas(produtos, latest, state) {
  const { alertas, novoState } = avaliarAlertas(produtos, latest, state);
  const apiKey = process.env.RESEND_API_KEY;
  const destinatario = process.env.ALERT_EMAIL;
  const dashboardUrl = process.env.DASHBOARD_URL ?? "";

  if (alertas.length === 0) {
    console.log("Alertas: nada a avisar nesta rodada.");
    return novoState;
  }
  if (!apiKey || !destinatario) {
    console.log(`Alertas: ${alertas.length} pendente(s), mas RESEND_API_KEY/ALERT_EMAIL não configurados — pulando envio.`);
    return novoState;
  }

  for (const alerta of alertas) {
    try {
      await enviarEmail(apiKey, destinatario, alerta, dashboardUrl);
      const s = novoState[alerta.produto.id];
      s.ultimoAlertaPreco = alerta.melhor.preco;
      s.ultimoAlertaEm = new Date().toISOString();
      console.log(`Alertas: email enviado — ${alerta.produto.nome} (${alerta.motivos.join("; ")})`);
    } catch (e) {
      console.error(`Alertas: falha ao enviar email de ${alerta.produto.id}: ${e.message}`);
    }
  }
  return novoState;
}
