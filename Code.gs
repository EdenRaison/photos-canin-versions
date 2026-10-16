/**
 * Photos Canin — partie « serveur » (Google Apps Script).
 *
 * Appli séparée de l'Agenda Canin, installée sur le même compte Google.
 *  - Elle LIT les séances, chiens et clients dans « Agenda Canin — base » (sans jamais y écrire).
 *    Si ce fichier n'existe pas, elle lit Google Agenda à la place.
 *  - Les photos gardées sont rangées dans Google Drive › Photos Canin › année › séance.
 *  - Un Google Sheets « Photos Canin — index » garde la liste des photos, des posts
 *    et ce que l'appli a appris (à quoi ressemble chaque chien, chaque obstacle).
 * Toute l'analyse des photos (flou, doublons, chien, cadrage) se fait sur le téléphone.
 */

// Version de ce code. Le bouton « Mettre à jour » compare avec le dépôt public ci-dessous.
const VERSION = '2026.10.16';
const DEPOT_MAJ = 'https://raw.githubusercontent.com/EdenRaison/photos-canin-versions/main/';

const TZ = 'Europe/Paris';
const RACINE = 'Photos Canin';
const BASE_AGENDA = 'Agenda Canin — base (ne pas modifier)';

const TABLES = {
  Photos: ['id', 'fileId', 'date', 'heure', 'seanceId', 'seanceNom', 'chienId', 'chienNom', 'clientId', 'clientNom', 'action', 'note', 'cadre', 'largeur', 'hauteur', 'ajoutee', 'miniature'],
  Accords: ['clientId', 'clientNom', 'accord', 'date'],
  Apprentissage: ['id', 'type', 'label', 'vecteur', 'date'],
  Posts: ['id', 'date', 'seanceId', 'titre', 'clientId', 'photos', 'format', 'texte', 'creneau', 'statut', 'dossier'],
  AutresChiens: ['id', 'nom', 'race', 'clientId', 'clientNom'],
};

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Photos Canin')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

/** À lancer une fois à la main : crée le dossier et l'index, et demande les autorisations. */
function installer() {
  const ss = index_();
  Object.keys(TABLES).forEach(t => sheet_(ss, t));
  const dossier = dossier_([]);
  const base = agendaBase_();
  CalendarApp.getDefaultCalendar().getName();
  Logger.log('Index : ' + ss.getUrl());
  Logger.log('Dossier des photos : ' + dossier.getUrl());
  Logger.log(base ? 'Agenda Canin trouvé ✓' : 'Agenda Canin pas trouvé : les séances seront lues dans Google Agenda.');
}

/* ================= Mise à jour de l'appli (bouton dans l'appli) ================= */
// L'appli lit la dernière version publiée sur un dépôt GitHub public qui ne contient que le code,
// remplace son propre code grâce à l'API Apps Script, puis republie le même lien.
// À activer une fois : script.google.com/home/usersettings → « API Google Apps Script » sur Activé.

/** Version installée + dernière version publiée (appelée à l'ouverture de l'appli). */
function infoVersion() {
  let derniere = null;
  try { derniere = JSON.parse(lireDepot_('version.json')); } catch (e) { /* pas de réseau : on réessaiera */ }
  return { actuelle: VERSION, derniere: derniere };
}

/** Installe la dernière version publiée, puis met à jour le lien de l'appli sur cette version. */
function mettreAJour() {
  const info = JSON.parse(lireDepot_('version.json'));
  if (info.version === VERSION) return { version: VERSION, deja: true, url: ScriptApp.getService().getUrl() };
  const code = lireDepot_('Code.gs'), index = lireDepot_('Index.html'), manifeste = lireDepot_('appsscript.json');
  if (code.indexOf('function doGet') < 0 || index.indexOf('</html>') < 0 || manifeste.indexOf('oauthScopes') < 0) {
    throw new Error('Les fichiers de la nouvelle version sont incomplets. Réessaie dans quelques minutes.');
  }
  const id = ScriptApp.getScriptId();
  const api = 'https://script.googleapis.com/v1/projects/' + id;
  // 1. Remplacer le code (en gardant d'éventuels autres fichiers du projet)
  const actuel = appelApi_('get', api + '/content');
  const fichiers = (actuel.files || []).filter(f => ['Code', 'Index', 'appsscript'].indexOf(f.name) < 0);
  fichiers.push({ name: 'appsscript', type: 'JSON', source: manifeste });
  fichiers.push({ name: 'Code', type: 'SERVER_JS', source: code });
  fichiers.push({ name: 'Index', type: 'HTML', source: index });
  appelApi_('put', api + '/content', { files: fichiers });
  // 2. Créer une version figée de ce code
  const v = appelApi_('post', api + '/versions', { description: 'Photos Canin ' + info.version });
  // 3. Faire pointer le lien de l'appli (même adresse qu'avant) sur cette version
  const deploiement = idDeploiement_();
  appelApi_('put', api + '/deployments/' + deploiement, {
    deploymentConfig: { scriptId: id, versionNumber: v.versionNumber, manifestFileName: 'appsscript', description: 'Photos Canin ' + info.version },
  });
  return { version: info.version, url: ScriptApp.getService().getUrl() };
}

function lireDepot_(nom) {
  const r = UrlFetchApp.fetch(DEPOT_MAJ + nom + '?t=' + Date.now(), { muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) throw new Error('Impossible de lire la nouvelle version (' + nom + '). Réessaie plus tard.');
  return r.getContentText();
}

function appelApi_(methode, url, corps) {
  const options = { method: methode, headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true };
  if (corps) { options.contentType = 'application/json'; options.payload = JSON.stringify(corps); }
  const r = UrlFetchApp.fetch(url, options);
  const texte = r.getContentText();
  if (r.getResponseCode() >= 300) {
    if (texte.indexOf('Apps Script API') >= 0 || texte.indexOf('usersettings') >= 0) {
      throw new Error('Il faut d’abord autoriser les mises à jour : ouvre script.google.com/home/usersettings et mets « API Google Apps Script » sur Activé, puis réessaie.');
    }
    throw new Error('La mise à jour n’a pas pu se faire (erreur ' + r.getResponseCode() + '). L’appli actuelle continue de fonctionner normalement.');
  }
  return texte ? JSON.parse(texte) : {};
}

// L'adresse de l'appli ressemble à https://script.google.com/macros/s/IDENTIFIANT/exec
function idDeploiement_() {
  const morceaux = ScriptApp.getService().getUrl().split('/');
  const i = morceaux.indexOf('s');
  if (i < 0 || !morceaux[i + 1]) throw new Error('Ouvre l’appli depuis son lien habituel (celui qui finit par /exec) pour faire la mise à jour.');
  return morceaux[i + 1];
}

/* ================= Fonctions appelées par l'appli ================= */

/**
 * Tout ce qu'il faut pour trier des photos prises à ces dates :
 * les séances de ces jours-là, tous les chiens connus, les accords photo et ce que l'appli a appris.
 */
function getContexte(dates) {
  const ss = index_();
  const agenda = lireAgenda_(dates || []);
  const autres = lire_(ss, 'AutresChiens');
  autres.forEach(d => { if (!agenda.chiens.some(x => x.id === d.id)) agenda.chiens.push(d); });
  const accords = {};
  lire_(ss, 'Accords').forEach(a => { accords[a.clientId] = a.accord; });
  // ce que l'appli a appris : les 500 derniers exemples de chiens et les 500 derniers exemples d'actions
  const tous = lire_(ss, 'Apprentissage');
  const appris = ['chien', 'action'].reduce((acc, t) => acc.concat(tous.filter(a => a.type === t).slice(-500)), [])
    .map(a => ({ type: a.type, label: a.label, vecteur: a.vecteur }));
  return { seances: agenda.seances, chiens: agenda.chiens, clients: agenda.clients, source: agenda.source, accords: accords, appris: appris };
}

/** Enregistre une photo gardée : le fichier dans Drive, une ligne dans l'index. */
function enregistrerPhoto(meta, jpegBase64, miniature) {
  const dossier = dossier_([meta.date.slice(0, 4), meta.date + ' — ' + (meta.seanceNom || 'Autres photos')]);
  const nom = [meta.date, meta.heure.replace(':', 'h'), meta.chienNom || 'chien', meta.action || ''].filter(x => x).join(' ').replace(/[\\/:*?"<>|]/g, '') + '.jpg';
  const blob = Utilities.newBlob(Utilities.base64Decode(jpegBase64), 'image/jpeg', nom);
  const file = dossier.createFile(blob);
  const row = Object.assign({}, meta, { id: meta.id, fileId: file.getId(), ajoutee: maintenant_(), miniature: miniature });
  withLock_(() => ajouter_(index_(), 'Photos', [row]));
  return { id: row.id, fileId: row.fileId, dossier: dossier_([]).getUrl() };
}

/** Ce que l'éducatrice a validé devient un exemple pour les prochaines fois. */
function apprendre(items) {
  if (!items || !items.length) return;
  withLock_(() => ajouter_(index_(), 'Apprentissage', items.map(i => ({ id: i.id, type: i.type, label: i.label, vecteur: i.vecteur, date: maintenant_() }))));
}

function setAccord(clientId, clientNom, accord) {
  return withLock_(() => {
    const ss = index_();
    const rows = lire_(ss, 'Accords');
    const r = rows.find(x => x.clientId === clientId);
    if (r) majLigne_(ss, 'Accords', r, { accord: accord, date: maintenant_() });
    else ajouter_(ss, 'Accords', [{ clientId: clientId, clientNom: clientNom, accord: accord, date: maintenant_() }]);
    return true;
  });
}

/** Chien absent de l'agenda (le sien, un nouveau client…). */
function ajouterChien(nom) {
  const d = { id: 'x' + Date.now().toString(36), nom: nom, race: '', clientId: '', clientNom: '' };
  withLock_(() => ajouter_(index_(), 'AutresChiens', [d]));
  return d;
}

/** Recherche dans les photos rangées. */
function chercher(f) {
  f = f || {};
  const rows = lire_(index_(), 'Photos');
  const facettes = { chiens: {}, clients: {}, mois: {}, actions: {} };
  rows.forEach(r => {
    if (r.chienId) facettes.chiens[r.chienId] = r.chienNom;
    if (r.clientId) facettes.clients[r.clientId] = r.clientNom;
    facettes.mois[r.date.slice(0, 7)] = 1;
    if (r.action) facettes.actions[r.action] = 1;
  });
  const q = sansAccents_(f.q || '');
  const res = rows.filter(r => {
    if (f.chienId && r.chienId !== f.chienId) return false;
    if (f.clientId && r.clientId !== f.clientId) return false;
    if (f.mois && r.date.slice(0, 7) !== f.mois) return false;
    if (f.action && r.action !== f.action) return false;
    if (!q) return true;
    const txt = sansAccents_([r.chienNom, r.clientNom, r.seanceNom, r.action, r.date, r.note].join(' '));
    return q.split(/\s+/).every(m => txt.indexOf(m) >= 0);
  }).sort((a, b) => (b.date + b.heure).localeCompare(a.date + a.heure));
  return { total: res.length, photos: res.slice(0, 150).map(publique_), facettes: facettes };
}

function getPhotos(ids) {
  const set = {};
  (ids || []).forEach(i => { set[i] = 1; });
  return lire_(index_(), 'Photos').filter(r => set[r.id]).map(publique_);
}

/** L'image en taille réelle (pour recadrer sur le téléphone). */
function getImage(fileId) {
  return Utilities.base64Encode(DriveApp.getFileById(fileId).getBlob().getBytes());
}

function majPhoto(id, champs) {
  return withLock_(() => {
    const ss = index_();
    const r = lire_(ss, 'Photos').find(x => x.id === id);
    if (!r) throw new Error('Photo introuvable');
    const ok = {};
    ['chienId', 'chienNom', 'clientId', 'clientNom', 'action', 'note'].forEach(k => { if (champs[k] !== undefined) ok[k] = champs[k]; });
    majLigne_(ss, 'Photos', r, ok);
    return publique_(Object.assign(r, ok));
  });
}

/** Tout ce qu'il faut pour l'onglet Publier : les posts, leurs photos et les accords photo. */
function getPublier() {
  const ss = index_();
  const posts = lire_(ss, 'Posts').sort((a, b) => b.date.localeCompare(a.date));
  const ids = {};
  posts.forEach(p => p.photos.split(',').forEach(i => { ids[i] = 1; }));
  const accords = {};
  lire_(ss, 'Accords').forEach(a => { accords[a.clientId] = a.accord; });
  return { posts: posts, photos: lire_(ss, 'Photos').filter(r => ids[r.id]).map(publique_), accords: accords };
}

function savePosts(posts) {
  return withLock_(() => {
    const ss = index_();
    const rows = lire_(ss, 'Posts');
    const neufs = [];
    posts.forEach(p => {
      const r = rows.find(x => x.id === p.id);
      if (r) majLigne_(ss, 'Posts', r, p); else neufs.push(p);
    });
    if (neufs.length) ajouter_(ss, 'Posts', neufs);
    return lire_(ss, 'Posts').sort((a, b) => b.date.localeCompare(a.date));
  });
}

function retirerPost(id) {
  return withLock_(() => {
    const ss = index_();
    const r = lire_(ss, 'Posts').find(x => x.id === id);
    if (r) sheet_(ss, 'Posts').deleteRow(r._row);
    return true;
  });
}

/** Range les images recadrées d'un post dans « Photos Canin › À publier » et renvoie les liens. */
function exporterImage(postId, titre, nom, jpegBase64) {
  const dossier = dossier_(['À publier', titre]);
  const it = dossier.getFilesByName(nom);
  while (it.hasNext()) it.next().setTrashed(true); // ancienne version du même recadrage
  const file = dossier.createFile(Utilities.newBlob(Utilities.base64Decode(jpegBase64), 'image/jpeg', nom));
  return { nom: nom, fileId: file.getId(), telecharger: 'https://drive.google.com/uc?export=download&id=' + file.getId(), dossier: dossier.getUrl() };
}

/* ================= Lecture de l'Agenda Canin ================= */

function agendaBase_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('AGENDA_BASE_ID');
  if (id) { try { return SpreadsheetApp.openById(id); } catch (e) {} }
  const it = DriveApp.getFilesByName(BASE_AGENDA);
  if (!it.hasNext()) return null;
  const f = it.next();
  props.setProperty('AGENDA_BASE_ID', f.getId());
  return SpreadsheetApp.open(f);
}

// Lit une feuille de l'agenda en se fiant aux titres de colonnes
function table_(ss, nom) {
  const sh = ss.getSheetByName(nom);
  if (!sh || sh.getLastRow() < 2) return [];
  const v = sh.getRange(1, 1, sh.getLastRow(), sh.getLastColumn()).getDisplayValues();
  const h = v[0];
  return v.slice(1).map(r => { const o = {}; h.forEach((c, i) => { o[c] = r[i]; }); return o; }).filter(o => o.id);
}

function lireAgenda_(dates) {
  const jours = {};
  dates.forEach(d => { jours[d] = 1; });
  const ss = agendaBase_();
  if (ss) {
    const clients = table_(ss, 'Clients'), chiens = table_(ss, 'Chiens');
    const cl = {};
    clients.forEach(c => { cl[c.id] = c; });
    const parts = table_(ss, 'Participations').filter(p => p.statut !== 'annule');
    const seances = table_(ss, 'Seances').filter(s => s.statut !== 'annule' && jours[s.debut.slice(0, 10)] && s.debut.length >= 16)
      .map(s => ({ id: s.id, debut: s.debut.slice(0, 16), duree: Number(s.duree) || 60, type: s.type, titre: s.titre,
        chiens: parts.filter(p => p.seanceId === s.id).map(p => p.chienId) }))
      .filter(s => s.chiens.length);
    return {
      source: 'agenda',
      seances: seances,
      chiens: chiens.map(d => ({ id: d.id, nom: d.nom, race: d.race, clientId: d.clientId, clientNom: (cl[d.clientId] || {}).nom || '' })),
      clients: clients.map(c => ({ id: c.id, nom: c.nom })),
    };
  }
  // Pas d'Agenda Canin : on prend les rendez-vous de Google Agenda
  const seances = [];
  const cal = CalendarApp.getDefaultCalendar();
  Object.keys(jours).forEach(d => {
    const debut = Utilities.parseDate(d + ' 00:00', TZ, 'yyyy-MM-dd HH:mm');
    cal.getEventsForDay(debut).forEach(ev => {
      if (ev.isAllDayEvent()) return;
      seances.push({ id: 'ev-' + ev.getId(), debut: Utilities.formatDate(ev.getStartTime(), TZ, "yyyy-MM-dd'T'HH:mm"),
        duree: Math.round((ev.getEndTime() - ev.getStartTime()) / 60000), type: '', titre: ev.getTitle(), chiens: [] });
    });
  });
  return { source: 'google-agenda', seances: seances, chiens: [], clients: [] };
}

/* ================= Stockage ================= */

function index_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('INDEX_ID');
  if (id) { try { return SpreadsheetApp.openById(id); } catch (e) {} }
  const ss = SpreadsheetApp.create('Photos Canin — index (ne pas modifier)');
  props.setProperty('INDEX_ID', ss.getId());
  return ss;
}

function dossier_(chemin) {
  const props = PropertiesService.getScriptProperties();
  let racine = null;
  const id = props.getProperty('DOSSIER_ID');
  if (id) { try { racine = DriveApp.getFolderById(id); if (racine.isTrashed()) racine = null; } catch (e) { racine = null; } }
  if (!racine) { racine = DriveApp.createFolder(RACINE); props.setProperty('DOSSIER_ID', racine.getId()); }
  return chemin.reduce((parent, nom) => {
    const it = parent.getFoldersByName(nom);
    return it.hasNext() ? it.next() : parent.createFolder(nom);
  }, racine);
}

function sheet_(ss, name) {
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    const cols = TABLES[name];
    sh.getRange(1, 1, sh.getMaxRows(), cols.length).setNumberFormat('@');
    sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold');
    sh.setFrozenRows(1);
    ss.getSheets().forEach(s => { if (!TABLES[s.getName()] && s.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(s); });
  }
  return sh;
}

function lire_(ss, t) {
  const cols = TABLES[t], sh = sheet_(ss, t), last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, cols.length).getDisplayValues()
    .map((row, i) => { const o = { _row: i + 2 }; cols.forEach((c, j) => { o[c] = row[j]; }); return o; })
    .filter(o => o.id || o.clientId);
}

function ajouter_(ss, t, objets) {
  const cols = TABLES[t], sh = sheet_(ss, t);
  const start = sh.getLastRow() + 1;
  const rg = sh.getRange(start, 1, objets.length, cols.length);
  rg.setNumberFormat('@');
  rg.setValues(objets.map(o => cols.map(c => o[c] === undefined || o[c] === null ? '' : String(o[c]))));
}

function majLigne_(ss, t, row, champs) {
  const cols = TABLES[t];
  Object.assign(row, champs);
  sheet_(ss, t).getRange(row._row, 1, 1, cols.length).setValues([cols.map(c => row[c] === undefined || row[c] === null ? '' : String(row[c]))]);
}

function publique_(r) { const o = {}; TABLES.Photos.forEach(c => { o[c] = r[c]; }); return o; }

/* ================= Outils ================= */

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try { return fn(); } finally { lock.releaseLock(); }
}
function maintenant_() { return Utilities.formatDate(new Date(), TZ, "yyyy-MM-dd'T'HH:mm"); }
function sansAccents_(s) { return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }
