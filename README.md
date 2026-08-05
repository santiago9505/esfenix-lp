# Esfenix Landing Page

Landing page y catalogo de productos de Esfenix.

- `/` — landing page (`index.html`)
- `/catalog` y `/catalog/<categoria>/<slug>` — catalogo B2B (`catalog.html`)

El catalogo es una herramienta de solicitud de cotizacion, no una tienda: no
muestra, guarda ni transmite precios. Su documentacion completa esta en
[docs/catalog.md](docs/catalog.md).

## Desarrollo local

Instala dependencias:

```sh
npm install
```

Ejecuta el modo desarrollo:

```sh
npm run dev
```

Genera el build para Firebase Hosting:

```sh
npm run build
```

El build se genera en `dist/`.

Optimiza imagenes y video antes de un build si cambian los assets fuente:

```sh
npm run optimize:assets
```

Ejecuta las pruebas (sin dependencias, usa `node --test`):

```sh
npm test
```

## Catalogo y Fresa

El catalogo se consume en runtime desde Fresa. La landing no mantiene una base
de datos local ni importa `products.generated.json` para mostrar productos.
Configura las variables en `.env.local` (el archivo no se versiona):

```env
FRESA_CATALOG_API_URL=http://localhost:3000/api/integrations/catalog
FRESA_CATALOG_API_KEY=replace-with-a-rotated-fresa-catalog-key
FRESA_CLIENTS_API_URL=http://localhost:3000/api/integrations/catalog
FRESA_CLIENTS_API_KEY=replace-with-a-rotated-fresa-active-clients-key
FRESA_QUOTE_SESSION_ENDPOINT=https://your-domain.example/api/quote-sessions
```

La consulta usa `Authorization: Bearer ...`, sigue `page.nextOffset` (o
`catalog.page.nextOffset` en la respuesta envuelta) hasta completar la
paginacion y revalida el catalogo cada 60 segundos. La integracion acepta tanto
`catalog.products` como `records` en el nivel superior. Las columnas se
interpretan desde `catalog.columns[].key` o `columns[].key`; las imagenes y archivos
usan directamente `attachment.url` y no se convierten ni se descargan desde
otra ruta. En produccion, rota la API key de prueba y permite el dominio de la
landing en CORS de Fresa.

Antes de abrir el formulario de cotizacion, la landing solicita el correo del
visitante y lo envia al flujo de cotizacion. La disponibilidad de la API de
clientes no bloquea el acceso al formulario: un correo nuevo o uno que no pueda
ser encontrado tambien puede solicitar una cotizacion. La landing no guarda ni
expone la lista de clientes; `FRESA_CLIENTS_API_URL` y
`FRESA_CLIENTS_API_KEY` quedan disponibles para la integracion segura del
servidor que prellena datos cuando exista un cliente.

Para prellenar de forma segura los datos de un cliente existente, configura
`FRESA_QUOTE_SESSION_ENDPOINT`. Ese endpoint recibe el payload por `POST`, usa
el correo para buscar los datos privados en el servidor y devuelve una URL
temporal del formulario de Fresa. Los datos personales no se guardan en
`localStorage` ni se incluyen en la URL; la ubicación sí se puede enviar como
contexto de la solicitud.

`listName` o una columna autorizada de categoria conservan la clasificacion
actual. Si se necesita una nueva clasificacion, debe autorizarse esa columna o
lista en Fresa.

La verificacion del mapeo historico del formulario de cotizacion sigue
disponible para el flujo existente:

```sh
npm run check:fresa-map
```

## Firebase Hosting

La configuracion de hosting usa `dist/` como carpeta publica. Despues de seleccionar el proyecto de Firebase, puedes desplegar con:

```sh
firebase deploy --only hosting
```

Los assets referenciados por la pagina deben existir en `assets/` en la raiz del proyecto.
