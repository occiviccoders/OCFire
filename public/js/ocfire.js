let map = null; // for the map
let occc = {} // for global data
const OCGeoCenter = [-117.823059, 33.669445] // center data on OC
// initialize the app
const loadApp = function(){
    // initiate MapBox
    mapboxgl.accessToken = "pk.eyJ1IjoiaW5pdGlhbGFwcHMiLCJhIjoiY2pzMnBzZGZnMDM0azQ5bDdyOHdraHV1ZyJ9.JdYkI5UwxhJgJOkbm2_8rw";
    map = new mapboxgl.Map({
        container: "map",
        style: 'mapbox://styles/mapbox/satellite-streets-v11',
        center: OCGeoCenter,
        zoom: 6
    });
    map.on('load', function(){                 
        let url = 'https://firms.modaps.eosdis.nasa.gov/wms/key/2147e40676a7ce56b909b75c37f6d145/?REQUEST=GetMap&layers=fires_viirs_24,fires_modis_24&WIDTH=512&HEIGHT=512&symbols=square,square&colors=240+40+40,250+200+50&size=8,8&BBOX={bbox-epsg-3857}&SRS=EPSG:3857';
        map.addSource('wms-test-source', {
            'type': 'raster',
            'tiles': [url],
            'tileSize': 512
        });
        map.addLayer(
            {
                'id': 'wms-test-layer',
                'type': 'raster',
                'source': 'wms-test-source'
            }
        );
    });
}
loadApp();