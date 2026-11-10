const prisma = require('../database/prisma');
const { catalog, scopes, defaults, validateThemeSetting } = require('../services/siteThemes');

/** GET never creates records; a fresh installation has both themes disabled. */
async function configuration() {
  const rows = await prisma.siteThemeSetting.findMany();
  return { catalog, settings: scopes.map(scope => rows.find(row => row.scope === scope) || defaults(scope)) };
}
exports.read = async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const data = await configuration();
    res.json({ ...data, ...(req.user ? { canManage: ['ADMIN', 'MANAGER'].includes(req.user.role) } : {}) });
  } catch { res.status(503).json({ error: 'Não foi possível carregar os temas. Tente novamente.' }); }
};
exports.update = async (req, res) => {
  try {
    const scope = req.params.scope;
    if (!scopes.includes(scope)) return res.status(400).json({ error: 'Destino de tema inválido.' });
    const data = validateThemeSetting(req.body);
    const updated = await prisma.$transaction(async tx => {
      // Concurrent first writes are protected by the primary key and subsequent CAS.
      await tx.siteThemeSetting.createMany({ data: [{ scope }], skipDuplicates: true });
      const result = await tx.siteThemeSetting.updateMany({ where: { scope, revision: data.revision }, data: { themeId: data.themeId, enabled: data.enabled, revision: { increment: 1 } } });
      if (result.count !== 1) throw Object.assign(new Error('O tema foi alterado em outra sessão. Recarregue antes de salvar.'), { status: 409 });
      return tx.siteThemeSetting.findUnique({ where: { scope } });
    });
    res.set('Cache-Control', 'no-store').json(updated);
  } catch (error) {
    const status = error.status || (['P2002', 'P2034'].includes(error.code) ? 409 : 500);
    res.status(status).json({ error: error.status ? error.message : status === 409 ? 'Alteração simultânea. Recarregue os temas.' : 'Não foi possível salvar o tema.' });
  }
};
