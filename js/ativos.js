// WealthFlow — LISTA ÚNICA dos ativos negociados em cotas (FIIs e ETFs).
// Para adicionar um ativo novo, basta acrescentar um item aqui: formulário de aporte, cotação ao vivo,
// carteira, alocação, alertas, conferência, gráfico, dividendos e o perfil enviado à IA
// leem desta lista. Os ativos com regras próprias (Tesouro IPCA+, Tesouro Selic, Bitcoin,
// Dividendo e Reserva) continuam tratados à parte no código.
//
// Usado no navegador (script clássico, carregado antes de core.js) e no servidor (api/market-data.js
// e api/cron-notify.js fazem require deste mesmo arquivo).
//
// Campos:
//   id          nome do ativo nos registros de aporte (não mude depois de ter aportes salvos)
//   key         prefixo dos campos na carteira do Firebase: <key>, <key>_cotas, <key>_preco
//   moeda       'BRL' ou 'EUR' — moeda em que o ativo é cotado
//   lado        'br' ou 'intl' — lado do 60/40
//   classe      'fii' | 'acoes-br' | 'acoes-global' | 'titulos-intl' (tipo do ativo; hoje só informativo)
//   tipo        texto da Carteira, antes da corretora
//   opcao       texto no formulário de aporte
//   icone       nome do ícone do sprite do index.html
//   yahoo       código no Yahoo Finance para a cotação ao vivo
//   dividendos  true se paga dividendo mensal (entra no aviso dos dias 14–15 e no painel de dividendos)
//   divPadrao   dividendo por cota usado só se o Yahoo estiver fora do ar
//   descricaoIA texto extra no perfil enviado ao Assistente
//   decCotas    casas decimais das cotas na Carteira; decConf: na conferência com a corretora
//   exitTax     retorno anual estimado {cons, otim} para o Exit Tax irlandês (só ETFs domiciliados na Irlanda/UE)
const ATIVOS = [
  { id: 'MXRF11', key: 'mxrf11', moeda: 'BRL', lado: 'br', classe: 'fii', corretora: 'Nubank',
    tipo: 'FII de papel', opcao: 'MXRF11 — FII Maxi Renda', icone: 'building', yahoo: 'MXRF11.SA',
    dividendos: true, divPadrao: 0.10, descricaoIA: '', decCotas: 0, decConf: 0 },
  { id: 'HGLG11', key: 'hglg11', moeda: 'BRL', lado: 'br', classe: 'fii', corretora: 'Nubank',
    tipo: 'FII de logística', opcao: 'HGLG11 — FII Logística', icone: 'warehouse', yahoo: 'HGLG11.SA',
    dividendos: true, divPadrao: 1.10, descricaoIA: 'FII logística', decCotas: 0, decConf: 0 },
  { id: 'KNRI11', key: 'knri11', moeda: 'BRL', lado: 'br', classe: 'fii', corretora: 'Nubank',
    tipo: 'FII híbrido', opcao: 'KNRI11 — FII Híbrido', icone: 'landmark', yahoo: 'KNRI11.SA',
    dividendos: true, divPadrao: 1.10, descricaoIA: 'FII híbrido', decCotas: 0, decConf: 0 },
  { id: 'BOVA11', key: 'bova11', moeda: 'BRL', lado: 'br', classe: 'acoes-br', corretora: 'Nubank',
    tipo: 'ETF Ibovespa', opcao: 'BOVA11 — ETF Ibovespa', icone: 'chart', yahoo: 'BOVA11.SA',
    dividendos: false, descricaoIA: 'ETF iShares Ibovespa, taxa 0,10% a.a., reinveste os dividendos — não distribui', decCotas: 0, decConf: 0 },
  { id: 'VWCE', key: 'vwce', moeda: 'EUR', lado: 'intl', classe: 'acoes-global', corretora: 'Revolut',
    tipo: 'ETF global (Acc)', opcao: 'VWCE — ETF Global', icone: 'globe', yahoo: 'VWCE.AS',
    dividendos: false, decCotas: 4, decConf: 8, exitTax: { cons: 0.04, otim: 0.08 } },
  // EUNA.DE (Xetra) — o EUNA.AS de Amsterdã é outra classe do fundo (~€49) e distorceria a carteira 10x
  { id: 'EUNA', key: 'euna', moeda: 'EUR', lado: 'intl', classe: 'titulos-intl', corretora: 'Revolut',
    tipo: 'ETF de títulos (Acc)', opcao: 'EUNA — ETF de Títulos', icone: 'shield', yahoo: 'EUNA.DE',
    dividendos: false, decCotas: 4, decConf: 8, exitTax: { cons: 0.02, otim: 0.04 } }
];

const ATIVO_POR_ID = Object.fromEntries(ATIVOS.map(a => [a.id, a]));
const ATIVOS_BR = ATIVOS.filter(a => a.lado === 'br');
const ATIVOS_INTL = ATIVOS.filter(a => a.lado === 'intl');
const ATIVOS_DIVIDENDOS = ATIVOS.filter(a => a.dividendos);

// O que conta como APORTE do mês: a compra de um ativo da carteira (FIIs, ETFs, Tesouro), com
// qualquer dinheiro. Não contam: Bitcoin (fora do plano), Reserva de emergência, dividendo, ajuste
// da conferência e os depósitos antigos na Caixinha. Regra única para o app inteiro (lembrete,
// "Este mês", resumo do mês, previsão da meta) e para a notificação do servidor.
const NAO_E_APORTE = ['Bitcoin', 'Reserva', 'Dividendo', 'Caixinha'];
function ehAporte(d) {
  return !!d && d.tipo !== 'ajuste' && !NAO_E_APORTE.includes(d.ativo);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { ATIVOS, ATIVO_POR_ID, ATIVOS_BR, ATIVOS_INTL, ATIVOS_DIVIDENDOS, ehAporte };
}

// Navegador: coloca os ativos no formulário de aporte — os do Brasil antes do Tesouro IPCA+,
// os internacionais no grupo Internacional
if (typeof document !== 'undefined') {
  const sel = document.getElementById('f-ativo');
  if (sel) {
    const opt = a => { const o = document.createElement('option'); o.value = a.id; o.textContent = a.opcao; return o; };
    const grupoBR = sel.querySelector('optgroup[label="Brasil"]');
    const ipca = grupoBR?.querySelector('option[value="IPCA+"]');
    ATIVOS_BR.forEach(a => grupoBR?.insertBefore(opt(a), ipca || null));
    const grupoIntl = sel.querySelector('optgroup[label="Internacional"]');
    ATIVOS_INTL.forEach(a => grupoIntl?.appendChild(opt(a)));
  }
}
