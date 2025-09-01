// ===============================================================================================
// ==                                    SERVER-SIDE CODE                                       ==
// ===============================================================================================

const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const PORT = process.env.PORT || 3000;

// Startovní pozice pro všechny hráče
const START_POSITION = { x: 0, y: 1, z: 0 };

let players = {};

io.on('connection', (socket) => {
    console.log(`New connection: ${socket.id}`);

    socket.on('joinGame', (playerName) => {
        players[socket.id] = {
            id: socket.id,
            name: playerName,
            position: START_POSITION,
            quaternion: { x: 0, y: 0, z: 0, w: 1 }, // Přidáváme i rotaci
        };
        console.log(`Player ${playerName} (${socket.id}) joined.`);

        // Pošle novému hráči data o všech hráčích (včetně jeho samotného)
        socket.emit('initializeSelf', players[socket.id], players);
        // Ostatním pošle jen info o novém hráči
        socket.broadcast.emit('newPlayer', players[socket.id]);
    });

    socket.on('playerMove', (playerData) => {
        if (players[socket.id]) {
            players[socket.id].position = playerData.position;
            players[socket.id].quaternion = playerData.quaternion;
        }
    });

    socket.on('disconnect', () => {
        if(players[socket.id]){
            console.log(`Player ${players[socket.id].name} (${socket.id}) disconnected.`);
            delete players[socket.id];
            io.emit('playerLeft', socket.id);
        }
    });
});

// Posíláme aktualizace 30x za sekundu
setInterval(() => {
    io.emit('gameStateUpdate', players);
}, 1000 / 30);

app.get('/', (req, res) => {
    res.send(generateHTML());
});

server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));

function generateHTML() {
    return `
<!DOCTYPE html>
<html lang="cs">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>3D Platformer - Ovládání</title>
    <style>
        body { margin: 0; overflow: hidden; background-color: #000; }
        canvas { display: block; cursor: grab; }
        canvas.locked { cursor: none; }
        #login-screen {
            position: absolute; top: 0; left: 0; width: 100%; height: 100%;
            background-color: rgba(0, 0, 0, 0.7); display: flex;
            justify-content: center; align-items: center; flex-direction: column; z-index: 10;
        }
        #login-screen h1, #info-overlay { color: white; font-family: sans-serif; text-shadow: 2px 2px 4px #000; }
        #info-overlay { position: absolute; top: 10px; left: 10px; z-index: 5; pointer-events: none; }
        #login-screen input { padding: 10px; font-size: 16px; margin-bottom: 10px; }
        #login-screen button { padding: 10px 20px; font-size: 16px; cursor: pointer; }
    </style>
    <!-- Načtení knihoven z CDN -->
    <script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/cannon-es@0.19.0/dist/cannon-es.min.js"></script>
    <script src="https://cdn.socket.io/4.7.5/socket.io.min.js"></script>
    <script src="https://unpkg.com/three@0.128.0/examples/js/renderers/CSS2DRenderer.js"></script>
</head>
<body>
    <div id="login-screen">
        <h1>Zadej své jméno</h1>
        <input type="text" id="playerNameInput" placeholder="Jméno hráče" maxlength="15">
        <button id="playButton">Hrát</button>
    </div>
    <div id="info-overlay">Kliknutím do hry zamknete kurzor. Stiskněte ESC pro uvolnění.</div>

    <script>
// ===============================================================================================
// ==                                     CLIENT-SIDE CODE                                      ==
// ===============================================================================================

// Globální proměnné
let scene, camera, renderer, labelRenderer, world;
let localPlayer = null; // Změna: začíná jako null
let players = {};
const keysPressed = {};
const socket = io();

// UI Elementy
const loginScreen = document.getElementById('login-screen');
const playerNameInput = document.getElementById('playerNameInput');
const playButton = document.getElementById('playButton');
const infoOverlay = document.getElementById('info-overlay');

// --- Logika pro připojení do hry ---
playButton.addEventListener('click', () => {
    const playerName = playerNameInput.value.trim();
    if (playerName) {
        loginScreen.style.display = 'none';
        infoOverlay.style.display = 'block';
        socket.emit('joinGame', playerName);
    }
});

// --- Inicializace 3D světa (volá se hned na začátku) ---
function init() {
    world = new CANNON.World({ gravity: new CANNON.Vec3(0, -20, 0) });
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87ceeb);

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 5, 10);
    
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);

    labelRenderer = new THREE.CSS2DRenderer();
    labelRenderer.setSize(window.innerWidth, window.innerHeight);
    labelRenderer.domElement.style.position = 'absolute';
    labelRenderer.domElement.style.top = '0px';
    document.body.appendChild(labelRenderer.domElement);
    
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(20, 30, 10);
    scene.add(dirLight);

    createStartPlatform();

    setupEventListeners();
    animate();
}

function createStartPlatform() {
    const platformBody = new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3(10, 0.5, 10)), position: new CANNON.Vec3(0, -0.5, 0) });
    world.addBody(platformBody);
    const platformMesh = new THREE.Mesh(new THREE.BoxGeometry(20, 1, 20), new THREE.MeshStandardMaterial({ color: 0x4CAF50 }));
    platformMesh.position.copy(platformBody.position);
    scene.add(platformMesh);
}

// Funkce pro vytvoření postavy hráče (lokálního i ostatních)
function createPlayer(playerInfo) {
    const color = (playerInfo.id === socket.id) ? 0xff4500 : 0x1e90ff;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: color }));
    scene.add(mesh);

    const body = new CANNON.Body({
        mass: 5,
        shape: new CANNON.Box(new CANNON.Vec3(0.5, 0.5, 0.5)),
        position: new CANNON.Vec3().copy(playerInfo.position),
        angularDamping: 1.0
    });
    world.addBody(body);

    const nameDiv = document.createElement('div');
    nameDiv.textContent = playerInfo.name;
    nameDiv.style.cssText = 'color: white; font-family: sans-serif; text-shadow: 1px 1px 2px black;';
    const nameLabel = new THREE.CSS2DObject(nameDiv);
    nameLabel.position.set(0, 0.8, 0);
    mesh.add(nameLabel);

    return { id: playerInfo.id, mesh, body, name: playerInfo.name };
}


// --- Komunikace se serverem ---
socket.on('initializeSelf', (playerData, allPlayers) => {
    // Vytvoříme lokálního hráče
    localPlayer = createPlayer(playerData);
    
    // Vytvoříme všechny ostatní hráče, kteří už byli ve hře
    for (const id in allPlayers) {
        if (id !== playerData.id) {
            players[id] = createPlayer(allPlayers[id]);
        }
    }
});

socket.on('newPlayer', (playerInfo) => {
    if (!localPlayer || playerInfo.id === localPlayer.id) return;
    if (!players[playerInfo.id]) {
        players[playerInfo.id] = createPlayer(playerInfo);
    }
});

socket.on('playerLeft', (playerId) => {
    if (players[playerId]) {
        scene.remove(players[playerId].mesh);
        world.removeBody(players[playerId].body);
        delete players[playerId];
    }
});

socket.on('gameStateUpdate', (serverPlayers) => {
    for (const id in serverPlayers) {
        if (localPlayer && id !== localPlayer.id && players[id]) {
            players[id].body.position.lerp(serverPlayers[id].position, 0.3);
            players[id].body.quaternion.slerp(serverPlayers[id].quaternion, 0.3);
        }
    }
});


// --- Ovládání, kamera a herní smyčka ---
const cameraOffset = new THREE.Vector3(0, 3, 6); // Zvětšená vzdálenost a výška kamery
let mouseX = 0, mouseY = 0;

function setupEventListeners() {
    document.addEventListener('keydown', (e) => { keysPressed[e.key.toLowerCase()] = true; });
    document.addEventListener('keyup', (e) => { keysPressed[e.key.toLowerCase()] = false; });
    window.addEventListener('resize', onWindowResize, false);

    // Zamknutí kurzoru
    renderer.domElement.addEventListener('click', () => {
        renderer.domElement.requestPointerLock();
    });
    
    document.addEventListener('pointerlockchange', () => {
        if (document.pointerLockElement === renderer.domElement) {
            document.addEventListener('mousemove', onMouseMove);
            renderer.domElement.classList.add('locked');
            infoOverlay.style.display = 'none';
        } else {
            document.removeEventListener('mousemove', onMouseMove);
            renderer.domElement.classList.remove('locked');
            infoOverlay.style.display = 'block';
        }
    });
}

function onMouseMove(event) {
    if (document.pointerLockElement === renderer.domElement) {
        mouseX -= event.movementX * 0.002;
        mouseY -= event.movementY * 0.002;
        // Omezení vertikálního otáčení, aby se kamera nepřetočila
        mouseY = Math.max(-Math.PI / 4, Math.min(Math.PI / 3, mouseY));
    }
}

let lastUpdateTime = 0;
function animate(time) {
    requestAnimationFrame(animate);

    const deltaTime = (time - (lastUpdateTime || time)) / 1000;
    lastUpdateTime = time;

    world.step(1/60, deltaTime, 3);
    
    if (localPlayer) {
        handlePlayerMovement();
        updateCamera();

        localPlayer.mesh.position.copy(localPlayer.body.position);
        localPlayer.mesh.quaternion.copy(localPlayer.body.quaternion);

        socket.emit('playerMove', {
            position: localPlayer.body.position,
            quaternion: localPlayer.body.quaternion,
        });
    }

    Object.values(players).forEach(p => {
        p.mesh.position.copy(p.body.position);
        p.mesh.quaternion.copy(p.body.quaternion);
    });
    
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
}

function handlePlayerMovement() {
    const speed = 5;
    const jumpForce = 8;
    
    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();

    const right = new THREE.Vector3().crossVectors(camera.up, forward).normalize();

    let moveDirection = new THREE.Vector3();
    if (keysPressed['w']) moveDirection.add(forward);
    if (keysPressed['s']) moveDirection.sub(forward);
    if (keysPressed['a']) moveDirection.add(right);
    if (keysPressed['d']) moveDirection.sub(right);
    
    // Udržení stávající vertikální rychlosti (gravitace, skok)
    const currentVelocityY = localPlayer.body.velocity.y;
    
    if (moveDirection.length() > 0.1) {
        moveDirection.normalize();
        localPlayer.body.velocity.x = moveDirection.x * speed;
        localPlayer.body.velocity.z = moveDirection.z * speed;

        // Otáčení hráče ve směru pohybu
        const targetQuaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.atan2(moveDirection.x, moveDirection.z));
        localPlayer.body.quaternion.slerp(targetQuaternion, 0.2, localPlayer.body.quaternion);
    } else {
        localPlayer.body.velocity.x *= 0.9;
        localPlayer.body.velocity.z *= 0.9;
    }
    
    localPlayer.body.velocity.y = currentVelocityY;

    if (keysPressed[' '] && Math.abs(localPlayer.body.velocity.y) < 0.1) {
        localPlayer.body.velocity.y = jumpForce;
    }
}

function updateCamera() {
    // Vypočítá pozici kamery na základě rotace myši
    const offset = cameraOffset.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), mouseX);
    offset.applyAxisAngle(new THREE.Vector3(1, 0, 0), mouseY);
    
    const cameraPosition = localPlayer.mesh.position.clone().add(offset);
    camera.position.lerp(cameraPosition, 0.1); // Plynulý přechod kamery
    camera.lookAt(localPlayer.mesh.position);
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    labelRenderer.setSize(window.innerWidth, window.innerHeight);
}

// Spustíme hru
init();

    </script>
</body>
</html>
    `;
}