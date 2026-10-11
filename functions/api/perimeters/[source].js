import { notFound, proxy } from '../../../server/proxy.js';

// Mirrors PERIMETER_SERVICES in vite.config.js.
const SERVICES = {
    firis: 'https://services1.arcgis.com/jUJYIo9tSA7EHvfZ/arcgis/rest/services/CA_Perimeters_NIFC_FIRIS_public_view/FeatureServer/0/query',
    wfigs: 'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters_Current/FeatureServer/0/query',
};

export function onRequest(context) {
    const service = SERVICES[context.params.source];
    if (!service) return notFound();
    const { search } = new URL(context.request.url);
    return proxy(context, `${service}${search}`, { ttl: 120, type: 'application/geo+json' });
}
