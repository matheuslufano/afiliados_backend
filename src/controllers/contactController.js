const prisma = require('../database/prisma');
const { isManager } = require('../services/crmAccess');

const CONTACT_STATUSES = new Set(['ACTIVE', 'INACTIVE', 'BLOCKED']);
const APPOINTMENT_STATUSES = new Set(['PENDING', 'COMPLETED', 'CANCELED', 'MISSED']);
const INTERACTION_TYPES = new Set(['WHATSAPP', 'PHONE', 'EMAIL', 'NOTE', 'SYSTEM']);

function text(value) {
  const result = String(value ?? '').trim();
  return result || null;
}

function digits(value) {
  const result = String(value ?? '').replace(/\D/g, '');
  return result || null;
}

function contactWhere(user) {
  return isManager(user) ? {} : { OR: [{ ownerUserId: user.id }, { ownerUserId: null }] };
}

function formatContact(contact) {
  const nextAppointment = contact.appointments?.[0] || null;
  const lastInteraction = contact.interactions?.[0] || null;
  return {
    id: String(contact.id),
    name: contact.name,
    phone: contact.phone,
    email: contact.email,
    document: contact.document,
    city: contact.city,
    neighborhood: contact.neighborhood,
    address: contact.address,
    status: contact.status,
    preferredChannel: contact.preferredChannel,
    notes: contact.notes,
    avatarUrl: contact.avatarUrl,
    owner: contact.owner ? { id: contact.owner.id, name: contact.owner.name } : null,
    totalConversions: contact._count?.conversions || 0,
    totalDeals: contact._count?.crmDeals || 0,
    totalInteractions: contact._count?.interactions || 0,
    nextAppointment: nextAppointment ? {
      id: String(nextAppointment.id),
      title: nextAppointment.title,
      scheduledAt: nextAppointment.scheduledAt,
      status: nextAppointment.status,
      color: nextAppointment.color || null
    } : null,
    appointments: (contact.appointments || []).map((appointment) => ({
      id: String(appointment.id),
      title: appointment.title,
      scheduledAt: appointment.scheduledAt,
      status: appointment.status,
      color: appointment.color || null
    })),
    lastInteraction: lastInteraction ? {
      type: lastInteraction.type,
      content: lastInteraction.content,
      occurredAt: lastInteraction.occurredAt
    } : null,
    createdAt: contact.createdAt,
    updatedAt: contact.updatedAt
  };
}

const includeContact = {
  owner: { select: { id: true, name: true } },
  appointments: { where: { status: 'PENDING' }, orderBy: { scheduledAt: 'asc' }, take: 20 },
  interactions: { orderBy: { occurredAt: 'desc' }, take: 1 },
  _count: { select: { conversions: true, crmDeals: true, interactions: true } }
};

class ContactController {
  async list(req, res) {
    try {
      const page = Math.max(1, Number(req.query.page) || 1);
      const pageSize = Math.min(100, Math.max(1, Number(req.query.pageSize) || 30));
      const q = text(req.query.search);
      const where = { deletedAt: null, ...contactWhere(req.user) };
      if (req.query.status && CONTACT_STATUSES.has(String(req.query.status))) where.status = req.query.status;
      if (req.query.ownerUserId) where.ownerUserId = Number(req.query.ownerUserId);
      if (q) {
        where.OR = [
          { name: { contains: q, mode: 'insensitive' } },
          { phone: { contains: digits(q) || q } },
          { email: { contains: q, mode: 'insensitive' } },
          { document: { contains: digits(q) || q } },
          { city: { contains: q, mode: 'insensitive' } }
        ];
      }
      const [rows, total] = await Promise.all([
        prisma.contact.findMany({ where, include: includeContact, orderBy: { updatedAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
        prisma.contact.count({ where })
      ]);
      return res.json({ contacts: rows.map(formatContact), total, page, pageSize, totalPages: Math.ceil(total / pageSize) });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Erro ao listar agenda de contatos' });
    }
  }

  async create(req, res) {
    try {
      const phone = digits(req.body.phone);
      const document = digits(req.body.document);
      if (!text(req.body.name) && !phone && !document) return res.status(400).json({ error: 'Informe nome, telefone ou documento' });
      const duplicate = await prisma.contact.findFirst({ where: { deletedAt: null, OR: [phone ? { phone } : undefined, document ? { document } : undefined].filter(Boolean) } });
      if (duplicate) return res.status(409).json({ error: 'Já existe um contato com este telefone ou documento', contact: formatContact(duplicate) });
      const contact = await prisma.contact.create({ data: { name: text(req.body.name), phone, email: text(req.body.email), document, city: text(req.body.city), neighborhood: text(req.body.neighborhood), address: text(req.body.address), status: CONTACT_STATUSES.has(req.body.status) ? req.body.status : 'ACTIVE', preferredChannel: text(req.body.preferredChannel) || 'WHATSAPP', notes: text(req.body.notes), ownerUserId: req.body.ownerUserId ? Number(req.body.ownerUserId) : req.user.id }, include: includeContact });
      return res.status(201).json({ contact: formatContact(contact) });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Erro ao criar contato' });
    }
  }

  async detail(req, res) {
    const id = Number(req.params.id);
    const contact = await prisma.contact.findFirst({ where: { id, deletedAt: null, ...contactWhere(req.user) }, include: { ...includeContact, conversions: { orderBy: { convertedAt: 'desc' }, take: 20 }, crmDeals: { orderBy: { updatedAt: 'desc' }, take: 10, select: { id: true, customerName: true, status: { select: { key: true, name: true } }, updatedAt: true } }, appointments: { orderBy: { scheduledAt: 'asc' }, take: 50 }, interactions: { orderBy: { occurredAt: 'desc' }, take: 100 } } });
    if (!contact) return res.status(404).json({ error: 'Contato não encontrado' });
    return res.json({ contact: formatContact(contact), conversions: contact.conversions, deals: contact.crmDeals, appointments: contact.appointments, interactions: contact.interactions });
  }

  async update(req, res) {
    const id = Number(req.params.id);
    const current = await prisma.contact.findFirst({ where: { id, deletedAt: null, ...contactWhere(req.user) } });
    if (!current) return res.status(404).json({ error: 'Contato não encontrado' });
    const data = {};
    for (const key of ['name', 'email', 'city', 'neighborhood', 'address', 'notes', 'avatarUrl']) if (req.body[key] !== undefined) data[key] = text(req.body[key]);
    if (req.body.phone !== undefined) data.phone = digits(req.body.phone);
    if (req.body.document !== undefined) data.document = digits(req.body.document);
    if (req.body.status !== undefined && CONTACT_STATUSES.has(req.body.status)) data.status = req.body.status;
    if (req.body.preferredChannel !== undefined) data.preferredChannel = text(req.body.preferredChannel) || 'WHATSAPP';
    if (req.body.ownerUserId !== undefined) data.ownerUserId = req.body.ownerUserId === null ? null : Number(req.body.ownerUserId);
    const duplicate = await prisma.contact.findFirst({ where: { id: { not: id }, deletedAt: null, OR: [data.phone ? { phone: data.phone } : undefined, data.document ? { document: data.document } : undefined].filter(Boolean) } });
    if (duplicate) return res.status(409).json({ error: 'Telefone ou documento já pertence a outro contato' });
    const contact = await prisma.contact.update({ where: { id }, data, include: includeContact });
    return res.json({ contact: formatContact(contact) });
  }

  async remove(req, res) {
    const id = Number(req.params.id);
    const contact = await prisma.contact.findFirst({ where: { id, deletedAt: null, ...contactWhere(req.user) } });
    if (!contact) return res.status(404).json({ error: 'Contato não encontrado' });
    await prisma.contact.update({ where: { id }, data: { deletedAt: new Date(), status: 'INACTIVE' } });
    return res.status(204).send();
  }

  async interaction(req, res) {
    const id = Number(req.params.id);
    const contact = await prisma.contact.findFirst({ where: { id, deletedAt: null, ...contactWhere(req.user) } });
    if (!contact) return res.status(404).json({ error: 'Contato não encontrado' });
    if (!text(req.body.content)) return res.status(400).json({ error: 'O conteúdo da interação é obrigatório' });
    const interaction = await prisma.contactInteraction.create({ data: { contactId: id, userId: req.user.id, type: INTERACTION_TYPES.has(req.body.type) ? req.body.type : 'NOTE', content: text(req.body.content), occurredAt: req.body.occurredAt ? new Date(req.body.occurredAt) : new Date() } });
    return res.status(201).json({ interaction });
  }

  async appointment(req, res) {
    const id = Number(req.params.id);
    const contact = await prisma.contact.findFirst({ where: { id, deletedAt: null, ...contactWhere(req.user) } });
    if (!contact) return res.status(404).json({ error: 'Contato não encontrado' });
    const scheduledAt = new Date(req.body.scheduledAt);
    if (!text(req.body.title) || Number.isNaN(scheduledAt.getTime())) return res.status(400).json({ error: 'Título e data do agendamento são obrigatórios' });
    const appointment = await prisma.contactAppointment.create({ data: { contactId: id, assignedUserId: req.body.assignedUserId ? Number(req.body.assignedUserId) : req.user.id, title: text(req.body.title), description: text(req.body.description), scheduledAt, durationMinutes: Math.max(5, Number(req.body.durationMinutes) || 30), reminderMinutes: req.body.reminderMinutes == null ? null : Math.max(0, Number(req.body.reminderMinutes)), color: text(req.body.color) } });
    return res.status(201).json({ appointment });
  }

  async updateAppointment(req, res) {
    const id = Number(req.params.id); const appointmentId = Number(req.params.appointmentId);
    const contact = await prisma.contact.findFirst({ where: { id, deletedAt: null, ...contactWhere(req.user) } });
    if (!contact) return res.status(404).json({ error: 'Contato não encontrado' });
    const data = {};
    for (const key of ['title', 'description', 'status', 'color']) if (req.body[key] !== undefined) data[key] = key === 'status' && !APPOINTMENT_STATUSES.has(req.body[key]) ? 'PENDING' : text(req.body[key]);
    if (req.body.scheduledAt) {
      data.scheduledAt = new Date(req.body.scheduledAt);
      if (Number.isNaN(data.scheduledAt.getTime())) return res.status(400).json({ error: 'Data do agendamento inválida' });
    }
    if (req.body.durationMinutes !== undefined) data.durationMinutes = Math.max(5, Number(req.body.durationMinutes) || 30);
    if (req.body.reminderMinutes !== undefined) data.reminderMinutes = req.body.reminderMinutes == null ? null : Math.max(0, Number(req.body.reminderMinutes) || 0);
    if (data.status === 'COMPLETED') data.completedAt = new Date();
    const appointment = await prisma.contactAppointment.update({ where: { id: appointmentId, contactId: id }, data });
    return res.json({ appointment });
  }

  async removeAppointment(req, res) {
    const id = Number(req.params.id); const appointmentId = Number(req.params.appointmentId);
    const contact = await prisma.contact.findFirst({ where: { id, deletedAt: null, ...contactWhere(req.user) } });
    if (!contact) return res.status(404).json({ error: 'Contato não encontrado' });
    await prisma.contactAppointment.delete({ where: { id: appointmentId, contactId: id } });
    return res.status(204).send();
  }
}

module.exports = new ContactController();
