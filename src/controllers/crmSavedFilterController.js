const prisma = require('../database/prisma');
const { isManager, parseConditions, SORTS } = require('../services/crmAccess');

function sanitize(body) {
  const name = String(body.name || '').trim();
  const visibility = body.visibility === 'SHARED' ? 'SHARED' : 'PRIVATE';
  const conditions = Array.isArray(body.conditions) ? body.conditions : [];
  const sort = body.sort?.mode ? { mode: String(body.sort.mode) } : null;
  const funnelId = body.funnelId ? Number(body.funnelId) : null;

  if (!name || name.length > 80) throw new Error('Nome do filtro e obrigatorio e deve ter ate 80 caracteres');
  parseConditions(conditions);
  if (sort && !SORTS[sort.mode]) throw new Error('Ordenacao invalida');
  if (funnelId !== null && (!Number.isInteger(funnelId) || funnelId < 1)) throw new Error('Funil invalido');

  return { name, visibility, conditions, sort, funnelId };
}

function format(filter) {
  return {
    id: String(filter.id),
    name: filter.name,
    ownerUserId: filter.ownerUserId,
    ownerName: filter.owner?.name,
    funnelId: filter.funnelId ? String(filter.funnelId) : null,
    conditions: filter.conditions,
    sort: filter.sort,
    visibility: filter.visibility,
    isDefault: filter.isDefault,
    createdAt: filter.createdAt,
    updatedAt: filter.updatedAt
  };
}

async function findEditable(id, user) {
  const filter = await prisma.savedCrmFilter.findUnique({ where: { id } });
  if (!filter) return { error: 'Filtro nao encontrado', status: 404 };
  if (filter.ownerUserId !== user.id && !(filter.visibility === 'SHARED' && isManager(user))) {
    return { error: 'Filtro nao pertence ao usuario autenticado', status: 403 };
  }
  return { filter };
}

class CrmSavedFilterController {
  async list(req, res) {
    const filters = await prisma.savedCrmFilter.findMany({
      where: { OR: [{ ownerUserId: req.user.id }, { visibility: 'SHARED' }] },
      include: { owner: { select: { name: true } } },
      orderBy: [{ isDefault: 'desc' }, { updatedAt: 'desc' }]
    });
    return res.json(filters.map(format));
  }

  async create(req, res) {
    try {
      const data = sanitize(req.body);
      if (data.visibility === 'SHARED' && !isManager(req.user)) {
        return res.status(403).json({ error: 'Somente gestores podem compartilhar filtros' });
      }
      const filter = await prisma.savedCrmFilter.create({
        data: { ...data, ownerUserId: req.user.id },
        include: { owner: { select: { name: true } } }
      });
      return res.status(201).json(format(filter));
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  }

  async update(req, res) {
    try {
      const id = Number(req.params.id);
      const access = await findEditable(id, req.user);
      if (access.error) return res.status(access.status).json({ error: access.error });
      const data = sanitize(req.body);
      if (data.visibility === 'SHARED' && !isManager(req.user)) {
        return res.status(403).json({ error: 'Somente gestores podem compartilhar filtros' });
      }
      const filter = await prisma.savedCrmFilter.update({
        where: { id },
        data,
        include: { owner: { select: { name: true } } }
      });
      return res.json(format(filter));
    } catch (error) {
      return res.status(400).json({ error: error.message });
    }
  }

  async duplicate(req, res) {
    const source = await prisma.savedCrmFilter.findFirst({
      where: {
        id: Number(req.params.id),
        OR: [{ ownerUserId: req.user.id }, { visibility: 'SHARED' }]
      }
    });
    if (!source) return res.status(404).json({ error: 'Filtro nao encontrado' });
    const filter = await prisma.savedCrmFilter.create({
      data: {
        name: `${source.name} (copia)`.slice(0, 80),
        funnelId: source.funnelId,
        conditions: source.conditions,
        sort: source.sort,
        visibility: 'PRIVATE',
        ownerUserId: req.user.id
      },
      include: { owner: { select: { name: true } } }
    });
    return res.status(201).json(format(filter));
  }

  async remove(req, res) {
    const access = await findEditable(Number(req.params.id), req.user);
    if (access.error) return res.status(access.status).json({ error: access.error });
    await prisma.savedCrmFilter.delete({ where: { id: access.filter.id } });
    return res.status(204).send();
  }

  async setDefault(req, res) {
    const id = Number(req.params.id);
    const filter = await prisma.savedCrmFilter.findFirst({
      where: {
        id,
        OR: [{ ownerUserId: req.user.id }, { visibility: 'SHARED' }]
      }
    });
    if (!filter) return res.status(404).json({ error: 'Filtro nao encontrado' });
    await prisma.$transaction([
      prisma.savedCrmFilter.updateMany({
        where: { ownerUserId: req.user.id, isDefault: true },
        data: { isDefault: false }
      }),
      filter.ownerUserId === req.user.id
        ? prisma.savedCrmFilter.update({ where: { id }, data: { isDefault: true } })
        : prisma.savedCrmFilter.create({
            data: {
              name: filter.name,
              funnelId: filter.funnelId,
              conditions: filter.conditions,
              sort: filter.sort,
              visibility: 'PRIVATE',
              isDefault: true,
              ownerUserId: req.user.id
            }
          })
    ]);
    return res.json({ success: true });
  }
}

module.exports = new CrmSavedFilterController();
