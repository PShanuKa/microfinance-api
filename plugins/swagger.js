import fp from 'fastify-plugin';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';

async function swaggerPlugin(fastify, options) {
    await fastify.register(swagger, {
        swagger: {
            info: {
                title: 'Microfinance API',
                description: 'API documentation for Microfinance Services',
                version: '1.0.0'
            },
            host: 'localhost:3000',
            schemes: ['http', 'https'],
            consumes: ['application/json'],
            produces: ['application/json'],
            tags: [
                { name: 'Auth', description: 'Authentication endpoints' },
                { name: 'Clients', description: 'Client management endpoints' },
            ],
            securityDefinitions: {
                cookieAuth: {
                    type: 'apiKey',
                    name: 'accessToken',
                    in: 'cookie',
                    description: 'User access token (automatically sent with cookie)'
                }
            }
        }
    });

    await fastify.register(swaggerUi, {
        routePrefix: '/documentation',
        uiConfig: {
            docExpansion: 'list',
            deepLinking: true
        },
        staticCSP: true,
        transformStaticCSP: (header) => header
    });
}

export default fp(swaggerPlugin);
