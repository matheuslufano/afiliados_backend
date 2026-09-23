const prisma = require('../database/prisma');
const crypto = require('crypto');
const { generateAffiliateCode } = require('../utils/affiliateCodes');
const QRCode = require('qrcode');
const {
  buildAffiliateUrl,
  buildNamedWhatsappTrackingUrl,
  buildWhatsappTrackingUrl,
  getDefaultLandingPageUrl,
  validateDestinationUrl
} = require('../utils/publicUrls');
const {
  buildWhatsAppUrl
} = require('../utils/whatsapp');
const {
  resolveTrackingTarget
} = require('../services/whatsappLinkService');
const {
  publishRealtimeEvent
} = require('../utils/realtimeEvents');
const { profilePhotoUrl } = require('../utils/profilePhotos');
const {
  collectVisitorTrackingData
} = require('../utils/visitorTracking');

function appendReferralCode(url, shortCode) {
  try {
    const destination = new URL(url);
    if (!destination.searchParams.has('ref')) {
      destination.searchParams.set('ref', shortCode);
    }
    return destination.toString();
  } catch {
    return url;
  }
}

function appendTrackingParameters(url, shortCode, clickCode, visitorId) {
  try {
    const destination = new URL(appendReferralCode(url, shortCode));
    destination.searchParams.set('click_id', clickCode);
    destination.searchParams.set('visitor_id', visitorId);
    return destination.toString();
  } catch {
    return appendReferralCode(url, shortCode);
  }
}

function trackingIdentity(req) {
  const cookie = String(req.headers.cookie || '');
  const storedVisitor = cookie.match(/(?:^|;\s*)nb_visitor=([^;]+)/)?.[1];
  const storedSession = cookie.match(/(?:^|;\s*)nb_session=([^;]+)/)?.[1];
  return {
    visitorId: storedVisitor || `v_${crypto.randomUUID()}`,
    sessionId: storedSession || `s_${crypto.randomUUID()}`
  };
}

function anonymizedIp(ipAddress) {
  if (!ipAddress) return null;
  return crypto.createHmac('sha256', process.env.CLICK_HASH_SECRET || process.env.JWT_SECRET || 'netbox-click').update(ipAddress).digest('hex');
}

function suspectedBot(userAgent) {
  return /bot|crawler|spider|slurp|facebookexternalhit|preview/i.test(String(userAgent || ''));
}

function optionalText(value) {
  const text = String(value || '').trim();
  return text || null;
}

function normalizePhone(value) {
  const phone = String(value || '').replace(/\D/g, '');
  return phone || null;
}

function normalizeDocument(value) {
  const document = String(value || '').replace(/\D/g, '');
  return document || null;
}

function normalizeContactName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

function isPlaceholderClientName(value) {
  return new Set([
    'cliente sem nome',
    'cliente nao identificado',
    'nao informado',
    'nao identificado',
    'unknown',
  ]).has(normalizeContactName(value));
}

function hasIdentifiedClient(conversion) {
  return Boolean(
    String(conversion?.visitorName || '').trim() &&
    !isPlaceholderClientName(conversion?.visitorName) &&
    normalizePhone(conversion?.visitorPhone)
  );
}

function contactIdentity(conversion) {
  const document = normalizeDocument(conversion.visitorDocument);
  if (document) return `document:${document}`;

  const phone = normalizePhone(conversion.visitorPhone);
  if (phone) return `phone:${phone}`;

  const name = normalizeContactName(conversion.visitorName);
  return name ? `name:${name}` : null;
}

function contactIdentityKeys(conversion) {
  const keys = [];
  const document = normalizeDocument(conversion.visitorDocument);
  const phone = normalizePhone(conversion.visitorPhone);
  const name = normalizeContactName(conversion.visitorName);

  if (document) keys.push(`document:${document}`);
  if (phone) {
    keys.push(`phone:${phone}`);
    if (phone.startsWith('55') && [12, 13].includes(phone.length)) {
      keys.push(`phone:${phone.slice(2)}`);
    }
  }
  if (conversion.attendanceId) {
    keys.push(`attendance:${conversion.attendanceId}`);
  }
  if (!document && !phone && name) keys.push(`name:${name}`);

  return keys.length ? keys : [`conversion:${conversion.id}`];
}

function contactsFromAffiliateLinks(links) {
  const contacts = new Map();

  links.forEach((link) => {
    link.conversionEvents.forEach((conversion) => {
      if (!hasIdentifiedClient(conversion)) return;
      const identity = contactIdentity(conversion);
      if (!identity) return;

      const eventDate = new Date(conversion.convertedAt);
      const eventTime = Number.isNaN(eventDate.getTime())
        ? 0
        : eventDate.getTime();
      const current = contacts.get(identity) || {
        id: identity,
        name: null,
        phone: null,
        document: null,
        city: null,
        firstAttendanceAt: conversion.convertedAt,
        lastAttendanceAt: conversion.convertedAt,
        firstAttendanceTime: eventTime,
        lastAttendanceTime: eventTime,
        attendanceKeys: new Set(),
        attendanceIds: new Set(),
        shortCodes: new Set(),
        linkIds: new Set(),
        conversionIds: new Set()
      };

      if (!current.name && conversion.visitorName) {
        current.name = conversion.visitorName;
      }
      if (!current.phone && conversion.visitorPhone) {
        current.phone = conversion.visitorPhone;
      }
      if (!current.document && conversion.visitorDocument) {
        current.document = conversion.visitorDocument;
      }
      if (!current.city && conversion.visitorCity) {
        current.city = conversion.visitorCity;
      }

      if (eventTime && eventTime < current.firstAttendanceTime) {
        current.firstAttendanceTime = eventTime;
        current.firstAttendanceAt = conversion.convertedAt;
      }
      if (eventTime && eventTime > current.lastAttendanceTime) {
        current.lastAttendanceTime = eventTime;
        current.lastAttendanceAt = conversion.convertedAt;
      }

      current.attendanceKeys.add(
        conversion.attendanceId || `conversion:${conversion.id}`
      );
      if (conversion.attendanceId) {
        current.attendanceIds.add(conversion.attendanceId);
      }
      current.shortCodes.add(link.shortCode);
      current.linkIds.add(link.id);
      current.conversionIds.add(conversion.id);
      contacts.set(identity, current);
    });
  });

  return [...contacts.values()]
    .sort((first, second) => second.lastAttendanceTime - first.lastAttendanceTime)
    .map((contact) => ({
      id: contact.id,
      name: contact.name,
      phone: contact.phone,
      document: contact.document,
      city: contact.city,
      totalAttendances: contact.attendanceKeys.size,
      totalConversions: contact.conversionIds.size,
      firstAttendanceAt: contact.firstAttendanceAt,
      lastAttendanceAt: contact.lastAttendanceAt,
      attendanceIds: [...contact.attendanceIds],
      shortCodes: [...contact.shortCodes],
      linkIds: [...contact.linkIds],
      conversionIds: [...contact.conversionIds]
    }));
}

function firstRequestValue(req, keys) {
  for (const key of keys) {
    const value = req.query?.[key] ?? req.body?.[key];

    if (value !== undefined && value !== null && value !== '') {
      return value;
    }
  }

  return null;
}

function visitorDataFromRequest(req) {
  return {
    visitorName: optionalText(
      firstRequestValue(req, ['visitorName', 'name', 'nome'])
    ),
    visitorPhone: normalizePhone(
      firstRequestValue(req, [
        'visitorPhone',
        'phone',
        'telefone',
        'whatsapp'
      ])
    ),
    visitorDocument: normalizeDocument(
      firstRequestValue(req, [
        'visitorDocument',
        'document',
        'documento',
        'cpf',
        'cnpj',
        'cpfcnpj'
      ])
    ),
    visitorCity: optionalText(
      firstRequestValue(req, ['visitorCity', 'city', 'cidade'])
    ),
    source: optionalText(firstRequestValue(req, ['source', 'origem']))
  };
}

async function formatLinkResponse(req, link) {
  const promoLink = buildAffiliateUrl(req, link.shortCode);

  return {
    id: link.id,
    name: link.name,
    campaignId: link.campaignId || null,
    originalUrl: link.originalUrl,
    shortCode: link.shortCode,
    promoLink,
    clicks: link.clicks.length,
    conversions: link.conversions.length,
    whatsappLink: buildWhatsappTrackingUrl(req, link.shortCode),
    createdAt: link.createdAt,
    affiliate: link.affiliate
      ? {
          id: link.affiliate.id,
          name: link.affiliate.name,
          email: link.affiliate.email,
          city: link.affiliate.city
        }
      : null,
    qrCode: await QRCode.toDataURL(promoLink, {
      margin: 1,
      width: 220
    })
  };
}

async function resolveOptionalAffiliateId(raw) {
  if (raw === undefined || raw === null || raw === '') {
    return { ok: true, id: undefined };
  }
  const n =
    typeof raw === 'number' && Number.isInteger(raw)
      ? raw
      : parseInt(String(raw).trim(), 10);
  if (!Number.isFinite(n) || n < 1) {
    return { ok: false, error: 'affiliateId inválido' };
  }
  const affiliate = await prisma.affiliate.findUnique({
    where: { id: n }
  });
  if (!affiliate) {
    return { ok: false, error: 'Afiliado não encontrado' };
  }
  return { ok: true, id: n };
}

class LinkController {
  async contacts(req, res) {
    try {
      const conversions = await prisma.conversion.findMany({
        orderBy: { convertedAt: 'desc' },
        include: {
          link: {
            select: {
              id: true,
              name: true,
              shortCode: true,
              affiliate: { select: { id: true, name: true } },
              campaign: { select: { id: true, name: true } }
            }
          }
        }
      });

      const contacts = [];
      const contactsByIdentity = new Map();
      conversions.forEach((conversion) => {
        const identityKeys = contactIdentityKeys(conversion);
        let contact = identityKeys
          .map((identity) => contactsByIdentity.get(identity))
          .find(Boolean);
        const isChatmix = Boolean(
          conversion.attendanceId ||
          /chatmix/i.test(`${conversion.source || ''} ${conversion.type || ''}`)
        );
        const source = isChatmix
          ? 'Chatmix'
          : (conversion.source || conversion.type || 'Conversão');

        if (!contact) {
          contact = {
            id: identityKeys[0],
            name: conversion.visitorName || null,
            phone: conversion.visitorPhone || null,
            document: conversion.visitorDocument || null,
            city: conversion.visitorCity || null,
            source,
            campaignName: conversion.link?.campaign?.name || null,
            linkName: conversion.link?.name || conversion.link?.shortCode || null,
            attendanceIds: new Set(),
            conversionIds: [conversion.id],
            affiliates: new Map(),
            firstSeenAt: conversion.convertedAt,
            lastSeenAt: conversion.convertedAt
          };
          contacts.push(contact);
        }

        identityKeys.forEach((identity) => contactsByIdentity.set(identity, contact));
        contact.name ||= conversion.visitorName || null;
        contact.phone ||= conversion.visitorPhone || null;
        contact.document ||= conversion.visitorDocument || null;
        contact.city ||= conversion.visitorCity || null;
        if (conversion.attendanceId) {
          contact.attendanceIds.add(conversion.attendanceId);
        }
        if (!contact.conversionIds.includes(conversion.id)) {
          contact.conversionIds.push(conversion.id);
        }
        if (conversion.link?.affiliate) {
          contact.affiliates.set(
            conversion.link.affiliate.id,
            conversion.link.affiliate.name
          );
        }
        if (new Date(conversion.convertedAt) < new Date(contact.firstSeenAt)) {
          contact.firstSeenAt = conversion.convertedAt;
        }
        if (new Date(conversion.convertedAt) > new Date(contact.lastSeenAt)) {
          contact.lastSeenAt = conversion.convertedAt;
          contact.source = source;
          contact.campaignName = conversion.link?.campaign?.name || contact.campaignName;
          contact.linkName = conversion.link?.name || conversion.link?.shortCode || contact.linkName;
        }
      });

      const formattedContacts = contacts.map((contact) => ({
        ...contact,
        identified: Boolean(contact.name || contact.phone || contact.document),
        attendanceIds: [...contact.attendanceIds],
        totalAttendances: contact.attendanceIds.size,
        totalConversions: contact.conversionIds.length,
        affiliates: [...contact.affiliates].map(([id, name]) => ({ id, name })),
        totalAffiliates: contact.affiliates.size
      }));

      return res.json({
        contacts: formattedContacts,
        total: formattedContacts.length
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Erro ao listar contatos' });
    }
  }

  async updateContact(req, res) {
    try {
      const conversionIds = Array.isArray(req.body.conversionIds)
        ? req.body.conversionIds.map(Number).filter((id) => Number.isInteger(id) && id > 0)
        : [];
      if (!conversionIds.length) {
        return res.status(400).json({ error: 'Contato sem registros para atualizar' });
      }

      const data = {};
      if (req.body.name !== undefined) data.visitorName = optionalText(req.body.name);
      if (req.body.phone !== undefined) data.visitorPhone = normalizePhone(req.body.phone);
      if (req.body.document !== undefined) data.visitorDocument = normalizeDocument(req.body.document);
      if (req.body.city !== undefined) data.visitorCity = optionalText(req.body.city);

      await prisma.conversion.updateMany({
        where: { id: { in: conversionIds } },
        data
      });
      return res.json({ message: 'Contato atualizado com sucesso' });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Erro ao atualizar contato' });
    }
  }

  async deleteContact(req, res) {
    try {
      const conversionIds = Array.isArray(req.body.conversionIds)
        ? req.body.conversionIds.map(Number).filter((id) => Number.isInteger(id) && id > 0)
        : [];
      if (!conversionIds.length) {
        return res.status(400).json({ error: 'Contato sem registros para apagar' });
      }

      // Preserve conversion and CRM history while removing the contact identity.
      await prisma.conversion.updateMany({
        where: { id: { in: conversionIds } },
        data: {
          visitorName: null,
          visitorPhone: null,
          visitorDocument: null,
          visitorCity: null
        }
      });
      return res.json({ message: 'Contato apagado com sucesso' });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Erro ao apagar contato' });
    }
  }

  async list(req, res) {
    try {
      const links = await prisma.link.findMany({
        orderBy: {
          createdAt: 'desc'
        },
        include: {
          affiliate: true,
          clicks: true,
          conversions: true
        }
      });

      const formattedLinks = await Promise.all(
        links.map((link) => formatLinkResponse(req, link))
      );

      return res.json(formattedLinks);
    } catch (error) {
      console.error(error);

      return res.status(500).json({
        error: 'Erro ao listar links'
      });
    }
  }

  async create(req, res) {
    try {
      const {
        name,
        url,
        affiliateId: rawAffiliateId
      } = req.body;

      const originalUrl = String(url || getDefaultLandingPageUrl()).trim();
      const destinationValidation = validateDestinationUrl(originalUrl);
      if (!destinationValidation.ok) {
        return res.status(400).json({ error: destinationValidation.error });
      }

      if (!originalUrl) {
        return res.status(400).json({
          error: 'URL é obrigatória'
        });
      }

      const linkName = String(name || '').trim();

      const affiliateResult =
        await resolveOptionalAffiliateId(rawAffiliateId);
      if (!affiliateResult.ok) {
        return res.status(400).json({
          error: affiliateResult.error
        });
      }
      const affiliateId = affiliateResult.id;

      let userId;
      if (process.env.DEFAULT_USER_ID) {
        userId = Number(process.env.DEFAULT_USER_ID);
        if (!Number.isFinite(userId) || userId < 1) {
          return res.status(400).json({
            error: 'DEFAULT_USER_ID inválido'
          });
        }
        const configuredUser = await prisma.user.findUnique({
          where: { id: userId }
        });
        if (!configuredUser) {
          return res.status(400).json({
            error: 'Usuário configurado em DEFAULT_USER_ID não existe'
          });
        }
      } else {
        const firstUser = await prisma.user.findFirst({
          orderBy: { id: 'asc' }
        });
        if (!firstUser) {
          return res.status(400).json({
            error:
              'Nenhum usuário cadastrado. Crie um usuário ou defina DEFAULT_USER_ID no ambiente.'
          });
        }
        userId = firstUser.id;
      }

      const maxAttempts = 8;
      let link;
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const shortCode = generateAffiliateCode();
        const affiliateUrl = buildAffiliateUrl(req, shortCode);
        try {
          link = await prisma.link.create({
            data: {
              name: linkName || null,
              originalUrl,
              shortCode,
              affiliateUrl,
              userId,
              ...(affiliateId !== undefined && { affiliateId })
            }
          });
          break;
        } catch (error) {
          // Único índice relevante no create é shortCode; meta.target varia por driver.
          if (error?.code === 'P2002' && attempt < maxAttempts - 1) {
            continue;
          }
          throw error;
        }
      }

      if (!link) {
        return res.status(500).json({
          error: 'Não foi possível gerar um código curto único'
        });
      }

      return res.status(201).json({
        message: 'Link criado com sucesso',
        link: buildAffiliateUrl(req, link.shortCode)
      });
    } catch (error) {
      console.error(error);

      if (error?.code === 'P2003') {
        return res.status(400).json({
          error:
            'Referência inválida (usuário ou afiliado). Verifique os dados.'
        });
      }

      return res.status(500).json({
        error: 'Erro ao criar link'
      });
    }
  }

  async update(req, res) {
    try {
      const id = Number(req.params.id);

      if (!Number.isFinite(id) || id < 1) {
        return res.status(400).json({
          error: 'ID do link invalido'
        });
      }

      const data = {};

      if (req.body.name !== undefined) {
        data.name = String(req.body.name || '').trim() || null;
      }

      const rawUrl =
        req.body.url !== undefined ? req.body.url : req.body.originalUrl;

      if (rawUrl !== undefined) {
        const originalUrl = String(rawUrl || '').trim();

        if (!originalUrl) {
          return res.status(400).json({
            error: 'URL e obrigatoria'
          });
        }

        data.originalUrl = originalUrl;
      }

      if (req.body.affiliateId !== undefined) {
        const affiliateResult =
          await resolveOptionalAffiliateId(req.body.affiliateId);

        if (!affiliateResult.ok) {
          return res.status(400).json({
            error: affiliateResult.error
          });
        }

        data.affiliateId = affiliateResult.id ?? null;
      }

      const link = await prisma.link.update({
        where: {
          id
        },
        data,
        include: {
          affiliate: true,
          clicks: true,
          conversions: true
        }
      });

      return res.json(await formatLinkResponse(req, link));
    } catch (error) {
      if (error?.code === 'P2025') {
        return res.status(404).json({
          error: 'Link nao encontrado'
        });
      }

      console.error(error);

      return res.status(500).json({
        error: 'Erro ao atualizar link'
      });
    }
  }

  async redirect(req, res) {
    try {
      const { shortCode } = req.params;

      const link = await prisma.link.findUnique({
        where: {
          shortCode
        }
      });

      if (!link) {
        return res.status(404).json({
          error: 'Link não encontrado'
        });
      }

      if (!link.active) {
        return res.status(410).json({ error: 'Link indisponível' });
      }

      const identity = trackingIdentity(req);
      const visitorData = collectVisitorTrackingData(req);
      const isSuspectedBot = suspectedBot(visitorData.userAgent);
      const recentClick = await prisma.click.findFirst({
        where: { linkId: link.id, visitorId: identity.visitorId, clickedAt: { gte: new Date(Date.now() - 30 * 60 * 1000) } },
        select: { id: true }
      });
      const click = await prisma.click.create({
        data: {
          ...visitorData,
          ipAddress: null,
          clickCode: `CLK-${crypto.randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()}`,
          visitorId: identity.visitorId,
          sessionId: identity.sessionId,
          ipHash: anonymizedIp(visitorData.ipAddress),
          destinationUrl: link.originalUrl,
          isUnique: !recentClick,
          isSuspectedBot,
          isValid: !isSuspectedBot,
          linkId: link.id
        }
      });

      res.cookie('nb_visitor', identity.visitorId, { maxAge: 365 * 24 * 60 * 60 * 1000, sameSite: 'lax', httpOnly: true, secure: req.secure });
      res.cookie('nb_session', identity.sessionId, { maxAge: 30 * 60 * 1000, sameSite: 'lax', httpOnly: true, secure: req.secure });

      publishRealtimeEvent('link-clicked', {
        linkId: link.id,
        shortCode: link.shortCode,
        clickedAt: click.clickedAt
      });

      return res.redirect(appendTrackingParameters(link.originalUrl, shortCode, click.clickCode, identity.visitorId));

    } catch (error) {
      console.error(error);

      return res.status(500).json({
        error: 'Erro ao acessar link'
      });
    }
  }

  async stats(req, res) {
    try {
      const { id } = req.params;

      const link = await prisma.link.findUnique({
        where: {
          id: Number(id)
        },
        include: {
          clicks: {
            orderBy: {
              clickedAt: 'desc'
            }
          },
          conversions: {
            orderBy: {
              convertedAt: 'desc'
            }
          }
        }
      });

      if (!link) {
        return res.status(404).json({
          error: 'Link não encontrado'
        });
      }

      return res.json({
        id: link.id,
        name: link.name,
        originalUrl: link.originalUrl,
        shortCode: link.shortCode,
        promoLink: buildAffiliateUrl(req, link.shortCode),
        totalClicks: link.clicks.length,
        totalConversions: link.conversions.length,
        whatsappLink: buildWhatsappTrackingUrl(req, link.shortCode),
        clicks: link.clicks,
        conversions: link.conversions
      });

    } catch (error) {
      console.error(error);

      return res.status(500).json({
        error: 'Erro ao buscar estatísticas'
      });
    }
  }

  async delete(req, res) {
    try {
      const id = Number(req.params.id);

      if (!Number.isFinite(id) || id < 1) {
        return res.status(400).json({
          error: 'ID do link invalido'
        });
      }

      const link = await prisma.link.findUnique({
        where: {
          id
        }
      });

      if (!link) {
        return res.status(404).json({
          error: 'Link nao encontrado'
        });
      }

      await prisma.$transaction([
        prisma.click.deleteMany({
          where: {
            linkId: id
          }
        }),
        prisma.conversion.deleteMany({
          where: {
            linkId: id
          }
        }),
        prisma.link.delete({
          where: {
            id
          }
        })
      ]);

      return res.json({
        message: 'Link apagado com sucesso'
      });
    } catch (error) {
      console.error(error);

      return res.status(500).json({
        error: 'Erro ao apagar link'
      });
    }
  }

  async updateConversion(req, res) {
    try {
      const id = Number(req.params.id);

      if (!Number.isFinite(id) || id < 1) {
        return res.status(400).json({
          error: 'ID da conversao invalido'
        });
      }

      const data = {};

      if (req.body.visitorName !== undefined) {
        data.visitorName = optionalText(req.body.visitorName);
      }

      if (req.body.visitorPhone !== undefined) {
        data.visitorPhone = normalizePhone(req.body.visitorPhone);
      }

      if (req.body.visitorDocument !== undefined) {
        data.visitorDocument = normalizeDocument(req.body.visitorDocument);
      }

      if (req.body.visitorCity !== undefined) {
        data.visitorCity = optionalText(req.body.visitorCity);
      }

      if (req.body.product !== undefined) {
        data.product = optionalText(req.body.product);
      }

      if (req.body.source !== undefined) {
        data.source = optionalText(req.body.source);
      }

      const conversion = await prisma.conversion.update({
        where: {
          id
        },
        data
      });

      return res.json(conversion);
    } catch (error) {
      if (error?.code === 'P2025') {
        return res.status(404).json({
          error: 'Conversao nao encontrada'
        });
      }

      console.error(error);

      return res.status(500).json({
        error: 'Erro ao atualizar conversao'
      });
    }
  }

  async deleteConversion(req, res) {
    try {
      const id = Number(req.params.id);

      if (!Number.isFinite(id) || id < 1) {
        return res.status(400).json({
          error: 'ID da conversao invalido'
        });
      }

      await prisma.conversion.delete({
        where: {
          id
        }
      });

      return res.json({
        message: 'Conversao apagada com sucesso'
      });
    } catch (error) {
      if (error?.code === 'P2025') {
        return res.status(404).json({
          error: 'Conversao nao encontrada'
        });
      }

      console.error(error);

      return res.status(500).json({
        error: 'Erro ao apagar conversao'
      });
    }
  }

  async affiliateStats(req, res) {
    try {
      const { id } = req.params;

      const affiliate = await prisma.affiliate.findUnique({
        where: {
          id: Number(id)
        },
        include: {
          links: {
            orderBy: {
              createdAt: 'desc'
            },
            include: {
              campaign: {
                select: { id: true, name: true }
              },
              whatsappLinks: {
                select: { id: true, name: true, createdAt: true },
                orderBy: { createdAt: 'desc' }
              },
              clicks: {
                orderBy: {
                  clickedAt: 'desc'
                }
              },
              conversions: {
                orderBy: {
                  convertedAt: 'desc'
                }
              }
            }
          }
        }
      });

      if (!affiliate) {
        return res.status(404).json({
          error: 'Afiliado não encontrado'
        });
      }

      const totalClicks = affiliate.links.reduce(
        (acc, link) => acc + link.clicks.length,
        0
      );

      const totalAttendances = affiliate.links.reduce(
        (acc, link) => acc + link.conversions.filter(hasIdentifiedClient).length,
        0
      );

      const totalConversions = affiliate.links.reduce(
        (acc, link) => acc + link.conversions.filter(hasIdentifiedClient).length,
        0
      );

      const formattedLinks = affiliate.links.map(link => {
        const latestClick = link.clicks[0] || null;

        const isWhatsAppLink = link.whatsappLinks.length > 0;
        const configuredWhatsAppLink = link.whatsappLinks[0] || null;
        const whatsappLink = configuredWhatsAppLink
          ? buildNamedWhatsappTrackingUrl(req, link.shortCode, configuredWhatsAppLink.name)
          : buildWhatsappTrackingUrl(req, link.shortCode);
        const promoLink = isWhatsAppLink
          ? whatsappLink
          : buildAffiliateUrl(req, link.shortCode);
        const displayName = isWhatsAppLink
          ? (configuredWhatsAppLink?.name || link.name)
          : link.name;
        const attendances = link.conversions.filter(hasIdentifiedClient).length;
        const identifiedConversions = link.conversions.filter(hasIdentifiedClient).length;
        const identifiedConversionEvents = link.conversions.filter(hasIdentifiedClient);

        return {
          id: link.id,
          name: displayName,
          shortCode: link.shortCode,
          originalUrl: link.originalUrl,
          clicks: link.clicks.length,
          conversions: identifiedConversions,
          attendances,
          whatsappLink,
          promoLink,
          latestClickAt: latestClick?.clickedAt || null,
          clickEvents: link.clicks.map(click => ({
            id: click.id,
            clickedAt: click.clickedAt,
            city: click.geoCity || null,
            source: click.source || click.utmSource || null
          })),
          conversionEvents: identifiedConversionEvents.map(conversion => ({
            id: conversion.id,
            attendanceId: conversion.attendanceId,
            type: conversion.type,
            product: conversion.product,
            destination: conversion.destination,
            visitorName: conversion.visitorName,
            visitorPhone: conversion.visitorPhone,
            visitorDocument: conversion.visitorDocument,
            visitorCity: conversion.visitorCity,
            source: conversion.source,
            ipAddress: conversion.ipAddress,
            userAgent: conversion.userAgent,
            referrer: conversion.referrer,
            utmSource: conversion.utmSource,
            utmMedium: conversion.utmMedium,
            utmCampaign: conversion.utmCampaign,
            utmTerm: conversion.utmTerm,
            utmContent: conversion.utmContent,
            deviceType: conversion.deviceType,
            browser: conversion.browser,
            operatingSystem: conversion.operatingSystem,
            platform: conversion.platform,
            language: conversion.language,
            geoCountry: conversion.geoCountry,
            geoRegion: conversion.geoRegion,
            geoCity: conversion.geoCity,
            timezone: conversion.timezone,
            screenWidth: conversion.screenWidth,
            screenHeight: conversion.screenHeight,
            convertedAt: conversion.convertedAt,
            linkId: link.id,
            linkName: link.name,
            shortCode: link.shortCode,
            originalUrl: link.originalUrl,
            promoLink,
            whatsappLink,
            totalClicks: link.clicks.length,
            latestClickAt: latestClick?.clickedAt || null
          })),
          linkType: link.whatsappLinks.length > 0
            ? 'whatsapp'
            : link.campaignId
              ? 'campaign'
              : /netbox/i.test(link.originalUrl)
                ? 'official'
                : 'individual',
          campaignName: link.campaign?.name || null
        };
      });
      const contacts = contactsFromAffiliateLinks(formattedLinks);

      return res.json({
        affiliate: affiliate.name,
        affiliatePhotoUrl: affiliate.photoUrl || profilePhotoUrl('affiliate', affiliate.id || affiliate.email || affiliate.name),
        photoUrl: affiliate.photoUrl || profilePhotoUrl('affiliate', affiliate.id || affiliate.email || affiliate.name),
        totalLinks: affiliate.links.length,
        totalClicks,
        totalAttendances,
        totalConversions,
        totalContacts: contacts.length,
        contacts,
        conversionEvents: formattedLinks.flatMap(link => link.conversionEvents),
        links: formattedLinks
      });
    } catch (error) {
      console.error(error);

      return res.status(500).json({
        error: 'Erro ao buscar estatísticas do afiliado'
      });
    }
  }

  async whatsapp(req, res) {
    try {
      const { shortCode } = req.params;
      const product =
        String(req.query.product || 'Plano Familia Netbox').trim();
      const visitorData = visitorDataFromRequest(req);

      const link = await prisma.link.findUnique({
        where: {
          shortCode
        }
      });

      if (!link) {
        return res.status(404).json({
          error: 'Link nao encontrado'
        });
      }

      const requestedMessage = req.query.message
        ? String(req.query.message)
        : `Tenho interesse no ${product}. Vim pelo link de divulgacao ${shortCode}.`;
      const whatsappLink = await resolveTrackingTarget({
        linkId: link.id,
        whatsappLinkId: req.query.whatsappLinkId,
        slug: req.params.linkSlug,
        message: requestedMessage
      });
      const isManagedWhatsAppLink = Boolean(req.params.linkSlug) || Boolean(req.query.whatsappLinkId) || req.query.source === 'whatsapp-link';
      if (isManagedWhatsAppLink && !whatsappLink) {
        return res.status(404).json({
          error: 'Configuração do link WhatsApp não encontrada'
        });
      }
      const destination = buildWhatsAppUrl({
        message: whatsappLink?.finalMessage || requestedMessage,
        phone: whatsappLink?.whatsappNumber
      });

      const identity = trackingIdentity(req);
      const technicalData = collectVisitorTrackingData(req);
      const isSuspectedBot = suspectedBot(technicalData.userAgent);
      const recentClick = await prisma.click.findFirst({
        where: { linkId: link.id, visitorId: identity.visitorId, clickedAt: { gte: new Date(Date.now() - 30 * 60 * 1000) } },
        select: { id: true }
      });
      const click = await prisma.click.create({
        data: {
          ...technicalData,
          ipAddress: null,
          source: visitorData.source || 'whatsapp',
          clickCode: `CLK-${crypto.randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()}`,
          visitorId: identity.visitorId,
          sessionId: identity.sessionId,
          ipHash: anonymizedIp(technicalData.ipAddress),
          destinationUrl: destination,
          isUnique: !recentClick,
          isSuspectedBot,
          isValid: !isSuspectedBot,
          linkId: link.id
        }
      });

      publishRealtimeEvent('link-clicked', {
        linkId: link.id,
        shortCode: link.shortCode,
        clickedAt: click.clickedAt
      });

      const conversion = await prisma.conversion.create({
        data: {
          type: 'whatsapp',
          product,
          destination,
          ...visitorData,
          ...technicalData,
          linkId: link.id,
          clickId: click.id
        }
      });

      publishRealtimeEvent('link-converted', {
        linkId: link.id,
        shortCode: link.shortCode,
        conversionId: conversion.id,
        product,
        convertedAt: conversion.convertedAt
      });

      if (req.method === 'POST') {
        return res.status(201).json({
          conversionId: conversion.id,
          destination,
          convertedAt: conversion.convertedAt
        });
      }

      return res.redirect(destination);
    } catch (error) {
      console.error(error);

      return res.status(500).json({
        error: 'Erro ao registrar conversao'
      });
    }
  }
}

module.exports = new LinkController();
