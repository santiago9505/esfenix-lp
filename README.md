# Esfenix Landing Page

Landing page y catálogo de productos de Esfenix.

- `/` — landing page (`index.html`)
- `/catalog` y `/catalog/<categoria>/<slug>` — catálogo B2B (`catalog.html`)

El catálogo es una herramienta de solicitud de cotización, no una tienda.
No muestra precios en el sitio público. Fresa vuelve a resolver el precio
vigente en el backend al crear cada subtarea. Su documentación completa está en
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

Genera el build estático para Firebase Hosting:

```sh
npm run build
```

El build se genera en `dist/`.

Optimiza imágenes y video antes de un build si cambian los assets fuente:

```sh
npm run optimize:assets
```

Ejecuta las pruebas:

```sh
npm test
```

## Catálogo y Fresa

El navegador pinta primero `public/data/catalog-snapshot.json`, que la portada
precarga en segundo plano, para no bloquear los productos con una llamada
externa. Después consulta la integración pública de Fresa —limitada a las tres
listas de Esfenix y a campos no sensibles— y actualiza el catálogo sin
interrumpir la vista. No recibe una API key ni columnas de precio. Comprueba una
revisión ligera cada 15 segundos y solo vuelve a descargar el catálogo vivo
cuando algo cambió.

El snapshot se puede regenerar localmente con credenciales privadas en
`.env.local` (ese archivo no se versiona):

```env
FRESA_CATALOG_API_URL=https://fresaai.app/api/public/v1/tasks
FRESA_CATALOG_API_KEY=replace-with-a-rotated-fresa-catalog-key
FRESA_CATALOG_SOURCES=[{"listId":"replace-with-list-id","name":"Texas","activeFieldId":"replace-with-active-field-id"}]
```

```sh
npm run snapshot:catalog
npm run check:fresa-map
npm test
npm run build
```

Las credenciales `FRESA_*` solo se usan en procesos server-side y nunca entran
al bundle del navegador. El formulario de cotización se envía a la API pública
del formulario de Fresa, pero la validación del cliente pasa por la Function
`fresaClientLookup`: recibe solo el email, consulta en tiempo real todas las
páginas de la lista de clientes activos y devuelve únicamente el perfil mínimo
para precargar el formulario. No hay caché del directorio y la API key vive en
Firebase Secret Manager. El borrador vive en `sessionStorage`, y la selección
de productos puede persistir como wishlist.

## Firebase Hosting y Functions

Hosting publica `dist/` y reescribe `/api/fresa-client-lookup` a la Function
server-side. El lookup seguro requiere el plan Blaze de Firebase, porque las
Cloud Functions no están disponibles en el plan Spark:

```sh
firebase functions:secrets:set FRESA_CLIENTS_API_KEY --project esfenix-landing-page
firebase deploy --only functions,hosting --project esfenix-landing-page
```

Los identificadores no secretos de Fresa tienen valores por defecto en
`functions/index.js` y pueden cambiarse con parámetros de Functions si Fresa
los modifica. No uses `VITE_` para la API key. Si todavía no se configura el
secreto o Functions, la landing permite continuar con cualquier email válido,
pero no puede completar automáticamente el perfil.

El build verifica automáticamente que ningún secreto de `.env.local` haya
entrado a `dist/` y que todos los scripts inline estén autorizados por la CSP.

## Delivery

Las ventanas de entrega son preferencias locales, no reservas. El visitante
elige una fecha y una de estas dos franjas: 8:00 AM–12:00 PM o 12:00–4:00 PM;
el equipo confirma disponibilidad,
mínimo de compra y hora final al revisar la solicitud. Así el flujo no necesita
Firestore ni ningún otro almacenamiento remoto.
