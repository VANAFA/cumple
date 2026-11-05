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

## Modo organizador: marcar "viaje resuelto" (punto verde)

Solo el organizador puede marcar a un invitado sin auto como **viaje resuelto**: su punto en el mapa
y en la lista pasan a verde para todos, y los conductores lo ven como "viaje resuelto" en sus sugerencias.

- Entrá a `https://cumple.nallib.ar/?admin`: aparece la tarjeta "Modo organizador" con email y contraseña
  (cuenta de Firebase Auth del proyecto `nallibar`, la misma que usa el chat de nallib.ar). Si no tenés
  cuenta, "Crear cuenta" la crea y manda un mail de verificación; después tocá "Ya verifiqué el mail".
- El email tiene que ser el de `adminEmail` en `js/config.js`, y **el mismo** que está en
  `firestore.rules` del repo `portfolio` (`isOrganizadorCumple`). Las reglas solo dejan cambiar el campo
  `resuelto` a esa cuenta con el mail verificado; cualquier otro escribe el documento conservando el valor.
- La sesión queda guardada en ese navegador (IndexedDB) y la página vuelve a cargar el modo organizador
  sola en las próximas visitas, sin `?admin`. "Salir" lo apaga.
- En la lista "Todos los invitados" cada invitado sin auto tiene el checkbox **resuelto**.
- Hasta desplegar las reglas con `resuelto` (`firebase deploy --only firestore:rules` desde `portfolio`),
  marcar da "permission denied" y la página lo avisa debajo de la lista.
- Con `?local=1&admin` el modo organizador se activa sin login (modo prueba).

## Datos que se guardan por invitado

`nombre, origen {lat, lng, label}, auto, lugares, vehiculo, color, patente, horaSalida, contacto, pasajeros[]`.
Opcional `resuelto` (bool): lo pone el organizador; la página lo conserva al editar.
Cada uno puede editar o borrar solo su propia entrada (se recuerda en el navegador). Como organizador podés
borrar/editar cualquiera desde la consola de Firebase (Firestore → cumple_invitados).
