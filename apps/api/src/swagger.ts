import swaggerJsdoc from 'swagger-jsdoc';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'LMIS API',
      version: '1.0.0',
      description: 'Labour Market Intelligence System API for MSDE, India. Provides demand-supply analytics, forecasting, gap scoring, and early warnings for the skilling ecosystem.',
      contact: { name: 'MSDE LMIS Team' },
    },
    servers: [{ url: '/api/v1', description: 'API v1' }],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
    },
  },
  apis: ['./src/routes/*.ts'],
};

export const swaggerSpec = swaggerJsdoc(options);
