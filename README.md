# Esfenix Landing Page

Landing page y catálogo de productos de Esfenix.

- `/` — landing page (`index.html`)
- `/catalog` y `/catalog/<categoria>/<slug>` — catálogo B2B (`catalog.html`)

El catálogo es una herramienta de solicitud de cotización, no una tienda.
Muestra los precios de referencia publicados en Fresa, pero no los envía como
parte de la orden: Fresa vuelve a resolver el precio vigente al crear cada
subtarea. Su documentación completa está en
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

El navegador usa únicamente `public/data/catalog-snapshot.json`, un snapshot
con los campos autorizados, precios e imágenes estables que está versionado
junto con el sitio. Para actualizarlo, ejecuta
localmente el generador con credenciales privadas en `.env.local` (ese archivo
no se versiona):

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

Las credenciales `FRESA_*` solo se usan durante `npm run snapshot:catalog` y
nunca entran al bundle ni se necesitan en producción. El formulario de
cotización se envía directamente a la API pública del formulario de Fresa. El
mismo formulario valida únicamente el email enviado contra su lista autorizada,
devuelve el perfil y el estado VIP cuando existe, y crea la tarea principal con
sus subtareas. No hay endpoint propio, Cloud Function ni base de datos. El
borrador vive en `sessionStorage`, y la selección de productos puede persistir
como wishlist.

## Firebase Hosting (plan básico)

La configuración publica únicamente `dist/`. No se despliegan Functions,
Firestore, Authentication ni secretos; por eso el proyecto puede permanecer en
el plan básico:

```sh
firebase deploy --only hosting --project esfenix-landing-page
```

El build verifica automáticamente que ningún secreto de `.env.local` haya
entrado a `dist/` y que todos los scripts inline estén autorizados por la CSP.

## Delivery

Las ventanas de entrega son preferencias locales, no reservas. El visitante
elige una fecha y franja de dos horas; el equipo confirma disponibilidad,
mínimo de compra y hora final al revisar la solicitud. Así el flujo no necesita
Firestore ni ningún otro almacenamiento remoto.
