const prisma = require('../database/prisma');

class AffiliateController {

  async create(req, res) {
    try {
      const {
        name,
        email,
        phone,
        city
      } = req.body;

      const trimmedName = String(name || '').trim();
      const trimmedEmail = String(email || '').trim();
      const trimmedPhone = String(phone || '').trim();
      const trimmedCity = String(city || '').trim();

      if (!trimmedName || !trimmedEmail) {
        return res.status(400).json({
          error: 'Nome e email sao obrigatorios'
        });
      }

      const affiliate =
        await prisma.affiliate.create({
          data: {
            name: trimmedName,
            email: trimmedEmail,
            phone: trimmedPhone || null,
            city: trimmedCity || null
          }
        });

      return res.status(201).json(
        affiliate
      );
    } catch (error) {
      if (error?.code === 'P2002') {
        return res.status(409).json({
          error: 'E-mail ja cadastrado'
        });
      }

      console.error(error);

      return res.status(500).json({
        error: 'Erro ao criar afiliado'
      });
    }
  }

  async list(req, res) {
    try {
      const affiliates =
        await prisma.affiliate.findMany({
          orderBy: {
            createdAt: 'desc'
          }
        });

      return res.json(affiliates);

    } catch (error) {
      console.error(error);

      return res.status(500).json({
        error: 'Erro ao listar afiliados'
      });
    }
  }

  async update(req, res) {
    try {
      const { id } = req.params;

      const {
        name,
        email,
        phone,
        city,
        active
      } = req.body;

      const data = {};

      if (name !== undefined) {
        data.name = String(name).trim();
      }

      if (email !== undefined) {
        data.email = String(email).trim();
      }

      if (phone !== undefined) {
        data.phone = String(phone).trim() || null;
      }

      if (city !== undefined) {
        data.city = String(city).trim() || null;
      }

      if (active !== undefined) {
        data.active = active;
      }

      const affiliate =
        await prisma.affiliate.update({
          where: {
            id: Number(id)
          },

          data
        });

      return res.json(affiliate);

    } catch (error) {
      if (error?.code === 'P2002') {
        return res.status(409).json({
          error: 'E-mail ja cadastrado'
        });
      }

      console.error(error);

      return res.status(500).json({
        error: 'Erro ao atualizar afiliado'
      });
    }
  }

  async delete(req, res) {
    try {
      const { id } = req.params;

      await prisma.affiliate.delete({
        where: {
          id: Number(id)
        }
      });

      return res.json({
        message:
          'Afiliado removido'
      });

    } catch (error) {
      console.error(error);

      return res.status(500).json({
        error: 'Erro ao deletar afiliado'
      });
    }
  }
}

module.exports =
  new AffiliateController();
