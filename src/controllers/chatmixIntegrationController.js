const {
  ChatmixApiError,
  getChatmixAttendanceMessages
} = require('../services/chatmixApi');

class ChatmixIntegrationController {
  async listAttendanceMessages(req, res) {
    try {
      const result = await getChatmixAttendanceMessages(
        req.params.attendanceId
      );

      return res.json(result);
    } catch (error) {
      if (error instanceof ChatmixApiError) {
        return res.status(error.httpStatus).json({
          error: error.message,
          code: error.code
        });
      }

      console.error('Erro inesperado ao buscar mensagens no Chatmix:', error);
      return res.status(500).json({
        error: 'Erro ao buscar mensagens no Chatmix',
        code: 'CHATMIX_MESSAGES_INTERNAL_ERROR'
      });
    }
  }
}

module.exports = new ChatmixIntegrationController();
