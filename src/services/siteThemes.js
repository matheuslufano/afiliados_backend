/** Fixed, reviewed visual presets. No executable markup or arbitrary CSS is stored. */
const catalog = [
  { id: 'christmas', name: 'Natal', occasion: '25 de dezembro', effect: 'snow', colors: ['#ffffff', '#d8ecf5', '#c64947'], greeting: 'Uma conexão cheia de boas histórias.', description: 'Neve suave, boneco de neve acenando e neve nas laterais do rodapé.' },
  { id: 'new-year', name: 'Ano Novo', occasion: '1º de janeiro', effect: 'stars', colors: ['#e5bc68', '#fff3ca', '#f7df9d'], greeting: 'Novas conexões. Novas possibilidades.', description: 'Estrelas douradas e um acabamento de celebração no rodapé.' },
  { id: 'carnival', name: 'Carnaval', occasion: 'Data móvel', effect: 'confetti', colors: ['#b784db', '#efbb57', '#58cbb9'], greeting: 'Mais cor para conectar a alegria.', description: 'Confetes coloridos e uma faixa festiva discreta.' },
  { id: 'womens-day', name: 'Dia da Mulher', occasion: '8 de março', effect: 'petals', colors: ['#be85bb', '#e3b5d5', '#c4a6e2'], greeting: 'Respeito, reconhecimento e conexão.', description: 'Pétalas lilás e homenagem no rodapé.' },
  { id: 'easter', name: 'Páscoa', occasion: 'Data móvel', effect: 'eggs', colors: ['#a4c9c0', '#edb6bc', '#dec58f'], greeting: 'Tempo de renovar os bons encontros.', description: 'Pequenos ovos em tons suaves e detalhes de renovação.' },
  { id: 'mothers-day', name: 'Dia das Mães', occasion: 'Segundo domingo de maio', effect: 'hearts', colors: ['#d990a5', '#edb9c4', '#c79cad'], greeting: 'Para quem faz toda conexão ter afeto.', description: 'Corações suaves e uma homenagem especial.' },
  { id: 'valentines', name: 'Dia dos Namorados', occasion: '12 de junho', effect: 'hearts', colors: ['#d35c78', '#ed9baa', '#c6819d'], greeting: 'Conecte-se com quem faz seu coração sorrir.', description: 'Corações em vermelho e rosa, com movimento delicado.' },
  { id: 'june-festival', name: 'Festas Juninas', occasion: 'Junho e julho', effect: 'flags', colors: ['#e9a64c', '#cf725d', '#75a9b7'], greeting: 'Uma conexão boa demais da conta.', description: 'Bandeirinhas coloridas junto ao rodapé.' },
  { id: 'fathers-day', name: 'Dia dos Pais', occasion: 'Segundo domingo de agosto', effect: 'stars', colors: ['#80accb', '#b2cbd8', '#c2aa78'], greeting: 'Conexões que acompanham cada passo.', description: 'Estrelas azuis e uma homenagem para os pais.' },
  { id: 'independence', name: 'Independência do Brasil', occasion: '7 de setembro', effect: 'confetti', colors: ['#55a56d', '#e2c157', '#6f9bc4'], greeting: 'Conectando histórias por todo o Brasil.', description: 'Confetes em verde, amarelo e azul.' },
  { id: 'childrens-day', name: 'Dia das Crianças', occasion: '12 de outubro', effect: 'confetti', colors: ['#75bccc', '#e9b156', '#db88ac'], greeting: 'Um mundo de descobertas para conectar.', description: 'Cores alegres e confetes leves.' },
  { id: 'halloween', name: 'Halloween', occasion: '31 de outubro', effect: 'bats', colors: ['#b586c9', '#e79c57', '#b0a0c9'], greeting: 'Boas histórias também dão um frio na barriga.', description: 'Morcegos discretos e um detalhe de Halloween no rodapé.' },
  { id: 'black-friday', name: 'Black Friday', occasion: 'Novembro', effect: 'confetti', colors: ['#e5ac59', '#a5a5b3', '#dfc18b'], greeting: 'Fique por dentro das novidades Netbox.', description: 'Confetes dourados e grafite, sem anunciar ofertas ou preços.' },
];
const scopes = ['blog', 'institutional'];
function defaults(scope) { return { scope, themeId: 'christmas', enabled: false, revision: 0, updatedAt: null }; }
function validateThemeSetting(body) {
  if (!body || !catalog.some(theme => theme.id === body.themeId) || typeof body.enabled !== 'boolean' || !Number.isSafeInteger(body.revision) || body.revision < 0) {
    throw Object.assign(new Error('Informe um tema válido, ativação e revisão atual.'), { status: 400 });
  }
  return { themeId: body.themeId, enabled: body.enabled, revision: body.revision };
}
module.exports = { catalog, scopes, defaults, validateThemeSetting };
