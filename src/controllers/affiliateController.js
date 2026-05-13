const prisma = require('../database/prisma');

class AffiliateController {

  async create(req, res) {
    try {
      const {
        name,
        email,
        phone
      } = req.body;

      const affiliate =
        await prisma.affiliate.create({
          data: {
            name,
            email,
            phone
          }
        });

      return res.status(201).json(
        affiliate
      );

    } catch (error) {
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
        active
      } = req.body;

      const affiliate =
        await prisma.affiliate.update({
          where: {
            id: Number(id)
          },

          data: {
            name,
            email,
            phone,
            active
          }
        });

      return res.json(affiliate);

    } catch (error) {
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