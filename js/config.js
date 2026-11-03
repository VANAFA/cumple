// ======================================================
//  CONFIGURACIÓN DE LA FIESTA — editá esto antes de subir
// ======================================================
window.CUMPLE_CONFIG = {
  titulo: "Cumple de Nalli",
  fecha: "Viernes 6 de noviembre",
  hora: "21:00",

  // Dónde es la fiesta. Sacá lat/lng de Google Maps (click derecho en el punto → copia las coordenadas).
  fiesta: {
    nombre: "La fiesta",
    direccion: "Barrio La Pradera, Villa Rosa, Pilar",   // se muestra a los invitados; poné calle y número si querés
    lat: -34.413254345693474,
    lng: -58.83739562788537,
  },

  // País para sesgar la búsqueda de direcciones (código ISO de 2 letras).
  pais: "ar",

  // Minutos extra (respecto al camino directo) hasta los que un invitado
  // cuenta como "de pasada" para un conductor.
  desvioMaxMin: 15,

  // Backend compartido: Firestore del mismo proyecto Firebase que nallib.ar.
  // Esta config es un identificador público, no un secreto; lo que protege son las
  // reglas (firestore.rules en el repo portfolio, colección "cumple_invitados").
  // Para probar sin tocar la base: abrí la página con ?local=1
  coleccion: "cumple_invitados",
  firebase: {
    apiKey: "AIzaSyBLLaO9M1Qf9qSXWojboxW3owGgFwgVe7E",
    authDomain: "nallibar.firebaseapp.com",
    projectId: "nallibar",
    storageBucket: "nallibar.firebasestorage.app",
    messagingSenderId: "759335511518",
    appId: "1:759335511518:web:bb9db619c85ffa444de94f",
  },
};
