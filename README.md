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
FRESA_CATALOG_INTEGRATION_ID=replace-with-catalog-integration-id
FRESA_CATALOG_API_URL=https://fresaai.app/api/integrations/lists/replace-with-catalog-integration-id
FRESA_CATALOG_API_KEY=replace-with-a-rotated-fresa-catalog-key
FRESA_CLIENTS_INTEGRATION_ID=replace-with-active-clients-integration-id
FRESA_CLIENTS_API_URL=https://fresaai.app/api/integrations/lists/replace-with-active-clients-integration-id
FRESA_CLIENTS_API_KEY=replace-with-a-rotated-fresa-active-clients-key
VITE_FRESA_QUOTE_SESSION_ENDPOINT=https://your-domain.example/api/quote-sessions
```

Las credenciales `FRESA_*` son exclusivas de Cloud Functions y nunca entran al
bundle del navegador. El endpoint same-origin `/api/catalog` consulta Fresa,
pagina la fuente, elimina campos privados y valores de precio, y mantiene una
respuesta CDN cacheable. La pagina pinta primero el snapshot local y revalida
en segundo plano, de modo que Fresa nunca bloquea el primer render.

Antes de abrir el formulario de cotizacion, la landing solicita el correo del
visitante y lo envia al flujo de cotizacion. La disponibilidad de la API de
clientes no bloquea el acceso al formulario: un correo nuevo o uno que no pueda
ser encontrado tambien puede solicitar una cotizacion. La landing no descarga
ni expone la lista de clientes. Envia un unico correo a
`/api/clients/lookup`; la Function consulta el directorio en memoria, limita la
tasa de solicitudes y devuelve como maximo el perfil coincidente.

La consulta segura de clientes ya funciona mediante `/api/clients/lookup`. Si
ademas existe un puente de sesiones propio, se puede configurar
`VITE_FRESA_QUOTE_SESSION_ENDPOINT`: recibe el payload final por `POST` y
devuelve una URL temporal del formulario de Fresa. Los datos personales no se guardan en
`localStorage` ni se incluyen en la URL. El borrador vive en `sessionStorage`,
expira a los 30 minutos y desaparece al cerrar la pestaña; la selección de
productos, que no contiene PII, sí puede persistir como wishlist.

`listName` o una columna autorizada de categoria conservan la clasificacion
actual. Si se necesita una nueva clasificacion, debe autorizarse esa columna o
lista en Fresa.

La verificacion del mapeo historico del formulario de cotizacion sigue
disponible para el flujo existente:

```sh
npm run check:fresa-map
```

## Firebase Hosting

La configuracion de hosting usa `dist/` como carpeta publica. Configura los
secretos privados antes del primer despliegue:

```sh
firebase functions:secrets:set FRESA_CATALOG_API_KEY
firebase functions:secrets:set FRESA_CLIENTS_API_KEY
```

Las URLs e IDs se solicitan como parametros durante el primer deploy de las
Functions. Despues de seleccionar el proyecto de Firebase, despliega backend y
hosting juntos:

```sh
firebase deploy --only functions,hosting
```

El build verifica automaticamente que ningun secreto de `.env.local` haya
entrado a `dist/` y que todos los scripts inline esten autorizados por la CSP.

Los assets referenciados por la pagina deben existir en `assets/` en la raiz del proyecto.

## Delivery slot capacity

La capacidad persistente de Delivery usa Firestore Standard directamente desde
el navegador, con una transacción y reglas que limitan cada fecha + franja a
dos reservas. Cada navegador obtiene una sesión de Firebase Anonymous Auth y
guarda una reserva idempotente, por lo que un reintento no consume un segundo
cupo. Pickup no lee ni reserva documentos de capacidad.

Para habilitarlo en Firebase, activa Authentication > Sign-in method >
Anonymous, despliega Firestore y Hosting:

```sh
firebase deploy --only functions,firestore,hosting
```

No hay una Function ni una variable de endpoint para esta capacidad; el flujo
funciona en el plan Spark mientras se mantenga dentro de las cuotas gratuitas.
Las reglas impiden que el navegador suba `booked` por encima de 2 y la
transacción protege el caso de dos visitantes confirmando al mismo tiempo.
Como riesgo residual del plan Spark, el acceso anónimo necesita controles de
abuso si la landing recibe tráfico automatizado; el código no expone credenciales
de administrador.
