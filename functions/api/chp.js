import { proxy } from '../../server/proxy.js';

export function onRequest(context) {
    return proxy(context, 'https://media.chp.ca.gov/sa_xml/sa.xml', { ttl: 60, type: 'text/xml' });
}
