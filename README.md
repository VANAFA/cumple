# Cumple · ¿cómo llegamos?

Página estática (GitHub Pages) para armar los combos de invitados que van a la fiesta.
Cada invitado carga de dónde sale el viernes 6, si tiene auto y cuántos lugares, y la página
muestra en el mapa a todos, calcula el camino a la fiesta y sugiere a quién le queda de pasada
buscar (o quién puede pasar a buscarte).

- Mapa: Leaflet + OpenStreetMap (tiles de CARTO).
- Caminos y desvíos: OSRM (servidor demo público, sin clave).
- Navegación: botón "Abrir en Google Maps" con las paradas del combo en orden.
- Datos compartidos: Firestore del proyecto Firebase de nallib.ar (`?local=1` fuerza el modo prueba en localStorage).

## 1. Configurar la fiesta

Editá `js/config.js`: título, fecha, hora, y **lat/lng de la fiesta** (en Google Maps, click derecho
sobre el punto → copia las coordenadas). Cambiá `desvioMaxMin` si querés otro umbral de "de pasada".

## 2. Base de datos: Firestore del proyecto de nallib.ar

La página usa el mismo proyecto Firebase que nallib.ar (`nallibar`, plan Spark), con la colección
`cumple_invitados`. La config del cliente ya está en `js/config.js` (es un identificador público,
no un secreto). Lo que protege la base son las reglas, que viven en el repo `portfolio`
(`firestore.rules`) porque un `firebase deploy` sube el archivo entero y pisa lo que haya.

Para activar la colección: mergear la rama `cumple-firestore-rules` del repo `portfolio` y desplegar
las reglas desde ese repo:

```bash
firebase deploy --only firestore:rules
```

Hasta que las reglas estén desplegadas, la página muestra el punto rojo de "Error de conexión"
(permission denied). Para probar sin tocar la base, abrí la página con `?local=1`.

## 3. Hosting: GitHub Pages en cumple.nallib.ar

El archivo `CNAME` ya dice `cumple.nallib.ar`. Falta:

1. Repo `VANAFA/cumple` público con esta carpeta y Pages activado desde `main` / raíz.
2. En Cloudflare (DNS de nallib.ar): registro **CNAME** `cumple` → `vanafa.github.io`, **sin proxy**
   (nube gris) hasta que GitHub emita el certificado; después se puede prender.
3. En GitHub → Settings → Pages → Custom domain `cumple.nallib.ar` y "Enforce HTTPS".

```bash
cd ~/Documents/personal/cumple
gh repo create cumple --public --source=. --remote=origin --push --description "Cumple: web para armar los combos de invitados"
gh api -X POST repos/VANAFA/cumple/pages -f build_type=legacy -f 'source[branch]=main' -f 'source[path]=/'
gh api -X PUT repos/VANAFA/cumple/pages -f cname=cumple.nallib.ar
```

> El botón "Usar mi ubicación" solo funciona con HTTPS (GitHub Pages lo tiene) o en `localhost`.

## Probar localmente

```bash
python3 -m http.server 8080
# abrir http://localhost:8080
```

Con `?local=1` la página avisa "Modo prueba" y guarda en localStorage. Para simular varios
invitados en tu PC, abrí la página en pestañas de distintos perfiles/incógnito, o borrá tu entrada y cargá otra.

## Cómo funciona el "de pasada"

Para cada conductor y cada invitado sin auto se pide a OSRM el camino directo (origen → fiesta) y el camino
pasando por el invitado (origen → invitado → fiesta). La diferencia en minutos es el desvío; si es menor
que `desvioMaxMin` se marca en verde. Cuando el conductor marca a quién lleva, se recalcula el camino
con las paradas en el orden óptimo (servicio `trip` de OSRM) y se arma el link a Google Maps con ese orden.

## Datos que se guardan por invitado

`nombre, origen {lat, lng, label}, auto, lugares, vehiculo, color, patente, horaSalida, contacto, pasajeros[]`.
Cada uno puede editar o borrar solo su propia entrada (se recuerda en el navegador). Como organizador podés
borrar/editar cualquiera desde la consola de Firebase (Firestore → cumple_invitados).
