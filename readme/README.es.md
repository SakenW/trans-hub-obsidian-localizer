# Trans-Hub Localizer

**Los complementos comunitarios de Obsidian, en tu idioma.**

[English](../README.md) · [简体中文](README.zh-CN.md) · [繁體中文](README.zh-TW.md) · [日本語](README.ja.md) · [한국어](README.ko.md) · [Deutsch](README.de.md) · [Français](README.fr.md) · **Español** · [Português (Brasil)](README.pt-BR.md) · [Русский](README.ru.md)

[![Release](https://img.shields.io/github/v/release/SakenW/trans-hub-obsidian-localizer)](https://github.com/SakenW/trans-hub-obsidian-localizer/releases) · **Escritorio y móvil** · **Sin configurar modelos de IA ni claves API**

Trans-Hub Localizer es un complemento de Obsidian que traduce y localiza las interfaces de los complementos comunitarios. Conserva las traducciones integradas que detecta, completa el contenido que falta con traducciones compartidas y sincroniza automáticamente las actualizaciones publicadas. Por defecto, aplica las traducciones durante la ejecución sin modificar los archivos de los complementos. No traduce ni sube tus notas.

[Instalar en Obsidian](obsidian://show-plugin?id=trans-hub-plugin-localizer) · [Progreso de localización](https://trans-hub.net/ecosystems/obsidian) · [Comentarios y comunidad](https://github.com/SakenW/Trans-Hub/discussions)

<!-- section: getting-started -->
## Primeros pasos

Necesitas **Obsidian 1.11.4 o posterior**, una cuenta de Trans-Hub y conexión de red para la autorización y la sincronización. Se admiten equipos de escritorio y dispositivos móviles; los parches avanzados de compatibilidad de archivos solo están disponibles en escritorio.

1. Instala y activa **Trans-Hub Localizer** en **Ajustes → Complementos comunitarios**.
2. Abre sus ajustes y conecta tu cuenta de Trans-Hub. No necesitas configurar un modelo de IA, una cuenta de proveedor de modelos ni una clave API.
3. Confirma el idioma de destino. Se detectan automáticamente los complementos comunitarios activados; puedes excluir los que no quieras localizar.

Las traducciones ya publicadas se reutilizan. Para el contenido que falta se envía automáticamente una solicitud de localización; se sincroniza después de su procesamiento en segundo plano y publicación. El texto puede permanecer en el idioma original mientras espera procesamiento, publicación o comprobaciones de compatibilidad.

Para instalarlo manualmente, descarga `main.js`, `manifest.json` y `styles.css` de la misma [versión de GitHub](https://github.com/SakenW/trans-hub-obsidian-localizer/releases) y colócalos en `<vault-config-dir>/plugins/trans-hub-plugin-localizer/`. No mezcles archivos de distintas versiones.

<!-- section: capabilities -->
## Funciones

| Función | Comportamiento |
| --- | --- |
| Prioridad a las traducciones integradas | Conserva las traducciones detectadas del complemento instalado y completa el texto que falta. Solo las correcciones revisadas explícitamente pueden sustituir el texto integrado correspondiente. |
| Traducciones compartidas | Los usuarios reutilizan los resultados publicados; el contenido que falta entra en el proceso compartido de localización. |
| Sincronización automática | Al iniciar, restaura primero las traducciones validadas en caché y busca actualizaciones durante la ejecución. Obtener nuevas traducciones requiere conexión de red. |
| Reutilización compatible tras actualizar | Las traducciones en tiempo de ejecución pueden reutilizarse entre versiones si cada entrada supera las comprobaciones de compatibilidad. Se omiten las entradas ambiguas o incompatibles. |
| Cobertura de interfaz | Admite nombres, descripciones, ajustes, botones, comandos, avisos, opciones, ayudas emergentes, indicaciones de entrada, etiquetas de accesibilidad y algunos textos dinámicos que se puedan identificar con seguridad. |
| README del complemento | Puede localizar el texto admitido de la página de detalles de un complemento comunitario cuando hay traducciones README publicadas y coincidentes. Su cobertura se cuenta por separado de la interfaz principal. |

Según corresponda, se comprueban la identidad del origen, el ámbito, la función semántica, el formato y los marcadores dinámicos. No se garantiza una traducción completa de todas las interfaces de todos los complementos.

<!-- section: languages -->
## Compatibilidad con todos los idiomas

Los idiomas de destino no están limitados a una lista fija. Elige un idioma habitual o introduce una etiqueta de idioma en el campo de otros idiomas, conservando las variantes regionales y de escritura.

Las opciones rápidas incluyen **chino simplificado, chino tradicional, inglés, japonés, coreano, alemán, francés, español, portugués de Brasil y ruso**. Otros ejemplos son italiano (`it`), árabe (`ar`), ucraniano (`uk`) y serbio en alfabeto latino (`sr-Latn`). La disponibilidad y la calidad concretas dependen de las traducciones publicadas y de los servicios de procesamiento disponibles para ese idioma.

Estos son los **idiomas de traducción de otros complementos**. Los ajustes del propio Localizer están disponibles actualmente en chino simplificado e inglés; para los demás idiomas se usa inglés. Los enlaces de la parte superior solo cambian el idioma de este README.

<!-- section: quality -->
## Calidad y alcance

Actualmente, la mayoría de las traducciones de Trans-Hub se generan automáticamente y no han sido corregidas por una persona. El complemento distingue el origen de la traducción y su estado de revisión. Superar las comprobaciones de origen y compatibilidad no implica que una persona haya revisado la precisión lingüística.

El proceso se dirige a complementos comunitarios cuya identidad y versión se pueden verificar mediante el directorio oficial de Obsidian y fuentes originales de confianza. La instalación mediante BRAT, los complementos privados o las modificaciones locales arbitrarias no reciben automáticamente una garantía de compatibilidad. El proceso actual usa inglés como idioma de origen.

Se excluyen los editores Markdown y las vistas de lectura de notas, el código, los scripts y el contenido editable. La localización de README se limita a la página de detalles del complemento comunitario y no activa la traducción de notas.

<!-- section: privacy -->
## Privacidad y parches de archivos opcionales

- El análisis local identifica las versiones de los complementos y el texto de interfaz admitido. No se suben los textos analizados ni las notas.
- Las solicitudes incluyen identidad del complemento, versión, idioma de destino, recuentos de cobertura y resúmenes criptográficos. La autorización de la cuenta y las descargas de traducciones requieren acceso a la red.
- Las credenciales usan el almacenamiento seguro de Obsidian. Consulta la [política de privacidad](https://trans-hub.net/zh-CN/legal/privacy) para conocer el tratamiento en el servidor.
- Por defecto, la localización en tiempo de ejecución no reescribe archivos del complemento. Al desactivarla, se restauran los textos que aún mantienen el valor traducido y se conservan los cambios posteriores realizados por otros complementos.

**El modo de compatibilidad avanzado solo está disponible en escritorio y está desactivado por defecto.** Debes aplicar explícitamente el parche a cada complemento apto. Solo modifica texto estático de interfaz validado, vinculado a la versión y al artefacto exactos, tras guardar una copia de seguridad y un comprobante. La restauración solo se realiza si el archivo aún coincide con el resumen criptográfico posterior al parche. Las actualizaciones del complemento y los cambios externos se conservan y se notifican como conflictos. Recarga el complemento afectado después de aplicar o restaurar un parche. Los parches nunca modifican las notas.

<!-- section: faq -->
## Preguntas frecuentes

**¿Necesito una clave API?** No. Conecta una cuenta de Trans-Hub; no tienes que configurar modelos ni claves API.

**¿Funciona en el teléfono?** Sí, la localización en tiempo de ejecución admite móviles y escritorio. Los parches de compatibilidad de archivos solo se ofrecen en escritorio.

**¿Por qué sigue habiendo texto sin traducir?** Puede estar pendiente la traducción, no ser posible verificar el origen o no poder identificarse la interfaz con seguridad. Consulta el estado del complemento. La ausencia de traducciones publicadas no significa que el idioma no sea compatible.

**¿Y si el complemento ya incluye mi idioma?** Las traducciones integradas detectadas tienen prioridad. Las traducciones compartidas completan los huecos; las correcciones revisadas son una excepción independiente y explícita.

**¿Qué ocurre al actualizar un complemento?** Se comprueba de nuevo la compatibilidad. Las entradas reutilizables siguen activas; las incompatibles esperan traducciones actualizadas. Los parches de archivos siguen exigiendo una coincidencia exacta.

**¿Se puede usar sin conexión?** Puedes reutilizar las traducciones validadas y guardadas previamente en caché. La autorización, el procesamiento del contenido que falta y las nuevas descargas requieren conexión de red.

<!-- section: contribute -->
## Colaborar y obtener ayuda

Participa en la [traducción, corrección y mantenimiento de terminología](https://trans-hub.net/ecosystems/obsidian). Comunica los problemas reproducibles en [Issues](https://github.com/SakenW/trans-hub-obsidian-localizer/issues) y las preguntas o sugerencias en [Discussions](https://github.com/SakenW/Trans-Hub/discussions).

El [README en chino simplificado](README.zh-CN.md) es la fuente de contenido para todas las versiones; el inglés es la entrada predeterminada de GitHub. Consulta las [instrucciones para contribuir](../CONTRIBUTING.md) sobre la sincronización de traducciones.

<!-- section: build -->
## Compilación y licencia

Usa Node.js 24 y pnpm 10.34.4:

```bash
pnpm install --frozen-lockfile
pnpm lint
pnpm type-check
pnpm test
pnpm verify:public-copy
pnpm build
```

Las etiquetas de versión deben coincidir con `manifest.json`, `package.json` y `versions.json`. Las versiones anteriores a `1.0.0` son versiones de prueba públicas. Licencia [Apache-2.0](../LICENSE).
