import { httpRouter } from 'convex/server';
import { authComponent, createAuth } from './auth';

const http = httpRouter();

// Better Auth's own routes, served from the Convex deployment.
authComponent.registerRoutes(http, createAuth);

export default http;
