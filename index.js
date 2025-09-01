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

// Uchovává stav všech hráčů na serveru
// Klíč je socket.id, hodnota je objekt s daty o hráči
let players = {};

// Herní logika na serveru
io.on('connection', (socket) => {
    console.log(`New player connected: ${socket.id}`);

    // Když se hráč připojí do hry se jménem
    socket.on('joinGame', (playerName) => {
        // Vytvoření nového hráče
        players[socket.id] = {
            id: socket.id,
            name: playerName,
            position: { x: 0, y: 1, z: 0 }, // Startovní pozice
            quaternion: { x: 0, y: 0, z: 0, w: 1 },
            finished: false
        };
        console.log(`Player ${playerName} (${socket.id}) joined the game.`);

        // Pošle novému hráči stav všech ostatních již připojených hráčů
        socket.emit('currentState', players);

        // Upozorní všechny ostatní hráče, že se připojil nový hráč
        socket.broadcast.emit('newPlayer', players[socket.id]);
    });

    // Když hráč aktualizuje svou pozici
    socket.on('playerMove', (playerData) => {
        if (players[socket.id]) {
            players[socket.id].position = playerData.position;
            players[socket.id].quaternion = playerData.quaternion;
        }
    });

    // Když hráč dosáhne cíle
    socket.on('reachFinish', () => {
        if (players[socket.id] && !players[socket.id].finished) {
            players[socket.id].finished = true;
            const message = `Hráč ${players[socket.id].name} dokončil závod!`;
            console.log(message);
            io.emit('gameMessage', message); // Pošle zprávu všem
        }
    });

    // Když se hráč odpojí
    socket.on('disconnect', () => {
        if(players[socket.id]){
            console.log(`Player ${players[socket.id].name} (${socket.id}) disconnected.`);
            delete players[socket.id];
            io.emit('playerLeft', socket.id);
        }
    });
});

// Server v pravidelných intervalech posílá aktualizovaný stav hry všem klientům
setInterval(() => {
    io.emit('gameStateUpdate', players);
}, 1000 / 30); // 30x za sekundu

// Servírování hlavní (a jediné) HTML stránky
app.get('/', (req, res) => {
    res.send(generateHTML());
});

server.listen(PORT, () => console.log(`Server listening on port ${PORT}`));

// Funkce, která generuje celý HTML, CSS a klientský JS kód
function generateHTML() {
    return `
<!DOCTYPE html>
<html lang="cs">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>3D Fall Guys Clone</title>
    <style>
        body { margin: 0; overflow: hidden; background-color: #333; }
        canvas { display: block; }
        #login-screen {
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0, 0, 0, 0.7);
            display: flex;
            justify-content: center;
            align-items: center;
            flex-direction: column;
            z-index: 10;
        }
        #login-screen h1 { color: white; font-family: sans-serif; }
        #login-screen input { padding: 10px; font-size: 16px; margin-bottom: 10px; border-radius: 5px; border: none; }
        #login-screen button { padding: 10px 20px; font-size: 16px; cursor: pointer; border-radius: 5px; border: none; background-color: #4CAF50; color: white; }
        #game-message {
            position: absolute;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            color: white;
            font-size: 24px;
            font-family: sans-serif;
            background-color: rgba(0,0,0,0.5);
            padding: 10px;
            border-radius: 10px;
            display: none;
        }
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
    <div id="game-message"></div>

    <script>
// ===============================================================================================
// ==                                     CLIENT-SIDE CODE                                      ==
// ===============================================================================================

// Proměnné pro hru
let scene, camera, renderer, labelRenderer;
let world;
let localPlayer = {}; // Objekt pro lokálního hráče
let players = {}; // Objekty pro ostatní hráče
let keysPressed = {};
const socket = io();

const loginScreen = document.getElementById('login-screen');
const playerNameInput = document.getElementById('playerNameInput');
const playButton = document.getElementById('playButton');
const gameMessage = document.getElementById('game-message');

playButton.addEventListener('click', () => {
    const playerName = playerNameInput.value.trim();
    if (playerName) {
        loginScreen.style.display = 'none';
        socket.emit('joinGame', playerName);
        init();
    }
});

// Inicializace celé hry
function init() {
    // Fyzikální svět
    world = new CANNON.World({
        gravity: new CANNON.Vec3(0, -20, 0), // Silnější gravitace
    });

    // 3D Scéna
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87ceeb); // Nebesky modrá

    // Kamera
    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 5, 10);
    
    // Renderer
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    document.body.appendChild(renderer.domElement);

    // Renderer pro jmenovky
    labelRenderer = new THREE.CSS2DRenderer();
    labelRenderer.setSize(window.innerWidth, window.innerHeight);
    labelRenderer.domElement.style.position = 'absolute';
    labelRenderer.domElement.style.top = '0px';
    document.body.appendChild(labelRenderer.domElement);
    
    // Osvětlení
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(20, 30, 10);
    dirLight.castShadow = true;
    scene.add(dirLight);

    // Vytvoření herního světa (levelu)
    createLevel();

    // Sledování stisku kláves
    document.addEventListener('keydown', (e) => { keysPressed[e.key.toLowerCase()] = true; });
    document.addEventListener('keyup', (e) => { keysPressed[e.key.toLowerCase()] = false; });
    
    window.addEventListener('resize', onWindowResize, false);
    
    animate();
}

function createLevel() {
    // Podlaha
    const groundMaterial = new CANNON.Material();
    const groundBody = new CANNON.Body({
        mass: 0,
        shape: new CANNON.Box(new CANNON.Vec3(20, 0.5, 100)),
        position: new CANNON.Vec3(0, -0.5, -70),
        material: groundMaterial
    });
    world.addBody(groundBody);
    
    const groundGeometry = new THREE.BoxGeometry(40, 1, 200);
    const groundMeshMaterial = new THREE.MeshStandardMaterial({ color: 0x228B22 });
    const groundMesh = new THREE.Mesh(groundGeometry, groundMeshMaterial);
    groundMesh.position.copy(groundBody.position);
    groundMesh.receiveShadow = true;
    scene.add(groundMesh);

    // Překážky
    createObstacle(new THREE.Vector3(10, 5, 2), new THREE.Vector3(0, 2, -20), 0xADD8E6);
    createObstacle(new THREE.Vector3(2, 5, 10), new THREE.Vector3(-8, 2, -40), 0x90EE90);
    createObstacle(new THREE.Vector3(2, 5, 10), new THREE.Vector3(8, 2, -40), 0x90EE90);
    createObstacle(new THREE.Vector3(10, 5, 2), new THREE.Vector3(0, 2, -60), 0xADD8E6);

    // Cílová čára
    const finishLineGeo = new THREE.BoxGeometry(40, 10, 0.5);
    const finishLineMat = new THREE.MeshBasicMaterial({ color: 0xffff00, transparent: true, opacity: 0.5 });
    const finishLineMesh = new THREE.Mesh(finishLineGeo, finishLineMat);
    finishLineMesh.position.set(0, 5, -160);
    finishLineMesh.name = "finishLine";
    scene.add(finishLineMesh);
}

function createObstacle(size, position, color) {
    const obstacleBody = new CANNON.Body({
        mass: 0,
        shape: new CANNON.Box(new CANNON.Vec3(size.x / 2, size.y / 2, size.z / 2)),
        position: new CANNON.Vec3(position.x, position.y, position.z)
    });
    world.addBody(obstacleBody);

    const obstacleGeometry = new THREE.BoxGeometry(size.x, size.y, size.z);
    const obstacleMaterial = new THREE.MeshStandardMaterial({ color: color });
    const obstacleMesh = new THREE.Mesh(obstacleGeometry, obstacleMaterial);
    obstacleMesh.position.copy(obstacleBody.position);
    obstacleMesh.castShadow = true;
    obstacleMesh.receiveShadow = true;
    scene.add(obstacleMesh);
}

// Funkce pro vytvoření hráče (vizuál i fyzika)
function createPlayer(playerInfo) {
    const color = (playerInfo.id === socket.id) ? 0xff0000 : 0x0000ff;
    
    const playerGeometry = new THREE.SphereGeometry(0.5, 32, 32);
    const playerMaterial = new THREE.MeshStandardMaterial({ color: color });
    const mesh = new THREE.Mesh(playerGeometry, playerMaterial);
    mesh.castShadow = true;
    scene.add(mesh);

    const playerShape = new CANNON.Sphere(0.5);
    const body = new CANNON.Body({
        mass: 5,
        position: new CANNON.Vec3(playerInfo.position.x, playerInfo.position.y, playerInfo.position.z),
        shape: playerShape,
        material: new CANNON.Material() // Unikátní materiál pro každého hráče
    });
    world.addBody(body);

    // Vytvoření jmenovky
    const nameDiv = document.createElement('div');
    nameDiv.className = 'player-label';
    nameDiv.textContent = playerInfo.name;
    nameDiv.style.color = 'white';
    nameDiv.style.fontFamily = 'sans-serif';
    nameDiv.style.backgroundColor = 'rgba(0,0,0,0.5)';
    nameDiv.style.padding = '2px 5px';
    nameDiv.style.borderRadius = '3px';
    
    const nameLabel = new THREE.CSS2DObject(nameDiv);
    nameLabel.position.set(0, 1, 0); // Pozice relativně k hráči
    mesh.add(nameLabel);

    return { id: playerInfo.id, mesh, body, label: nameLabel, name: playerInfo.name };
}

// Socket.IO event handlery
socket.on('currentState', (serverPlayers) => {
    Object.values(serverPlayers).forEach(playerInfo => {
        if (playerInfo.id === socket.id) {
            localPlayer = createPlayer(playerInfo);
        } else {
            players[playerInfo.id] = createPlayer(playerInfo);
        }
    });
});

socket.on('newPlayer', (playerInfo) => {
    if (playerInfo.id !== socket.id) {
        players[playerInfo.id] = createPlayer(playerInfo);
    }
});

socket.on('playerLeft', (playerId) => {
    if (players[playerId]) {
        scene.remove(players[playerId].mesh);
        world.removeBody(players[playerId].body);
        players[playerId].mesh.remove(players[playerId].label); // Odstraní i jmenovku
        delete players[playerId];
    }
});

socket.on('gameStateUpdate', (serverPlayers) => {
    Object.values(serverPlayers).forEach(playerInfo => {
        // Aktualizujeme jen ostatní hráče, lokální hráč se ovládá sám
        if (playerInfo.id !== socket.id && players[playerInfo.id]) {
            players[playerInfo.id].body.position.copy(playerInfo.position);
            players[playerInfo.id].body.quaternion.copy(playerInfo.quaternion);
        }
    });
});

socket.on('gameMessage', (message) => {
    gameMessage.textContent = message;
    gameMessage.style.display = 'block';
    setTimeout(() => {
        gameMessage.style.display = 'none';
    }, 5000);
});

let lastUpdateTime = 0;
// Herní smyčka
function animate(time) {
    requestAnimationFrame(animate);

    const deltaTime = (time - (lastUpdateTime || time)) / 1000;
    lastUpdateTime = time;

    // Aktualizace fyziky
    world.step(1/60, deltaTime, 3);
    
    // Ovládání lokálního hráče
    if (localPlayer.body) {
        handleControls();

        // Synchronizace vizuálu s fyzikou pro lokálního hráče
        localPlayer.mesh.position.copy(localPlayer.body.position);
        localPlayer.mesh.quaternion.copy(localPlayer.body.quaternion);

        // Odeslání pozice na server
        socket.emit('playerMove', {
            position: localPlayer.body.position,
            quaternion: localPlayer.body.quaternion,
        });

        // Kamera sleduje hráče
        const cameraOffset = new THREE.Vector3(0, 5, 10);
        const playerPosition = localPlayer.mesh.position.clone();
        camera.position.lerp(playerPosition.add(cameraOffset), 0.1);
        camera.lookAt(localPlayer.mesh.position);

        // Detekce cílové čáry
        if (localPlayer.body.position.z < -160) {
            socket.emit('reachFinish');
        }
    }

    // Synchronizace vizuálu s fyzikou pro ostatní hráče
    Object.values(players).forEach(p => {
        p.mesh.position.copy(p.body.position);
        p.mesh.quaternion.copy(p.body.quaternion);
    });
    
    renderer.render(scene, camera);
    labelRenderer.render(scene, camera);
}

function handleControls() {
    const speed = 10;
    const jumpForce = 15;
    const moveDirection = new THREE.Vector3();

    if (keysPressed['w']) moveDirection.z -= 1;
    if (keysPressed['s']) moveDirection.z += 1;
    if (keysPressed['a']) moveDirection.x -= 1;
    if (keysPressed['d']) moveDirection.x += 1;
    
    if (moveDirection.length() > 0) {
        moveDirection.normalize();
        
        // Získání směru kamery
        const cameraDirection = new THREE.Vector3();
        camera.getWorldDirection(cameraDirection);
        cameraDirection.y = 0;
        cameraDirection.normalize();

        // Výpočet směru pohybu relativně ke kameře
        const right = new THREE.Vector3().crossVectors(camera.up, cameraDirection).normalize();
        const forward = cameraDirection;
        const finalMove = right.multiplyScalar(-moveDirection.x).add(forward.multiplyScalar(-moveDirection.z));

        localPlayer.body.velocity.x = finalMove.x * speed;
        localPlayer.body.velocity.z = finalMove.z * speed;
    } else {
        localPlayer.body.velocity.x *= 0.9; // Zpomalení
        localPlayer.body.velocity.z *= 0.9;
    }

    // Skok
    if (keysPressed[' '] && Math.abs(localPlayer.body.velocity.y) < 0.1) {
        localPlayer.body.velocity.y = jumpForce;
    }
}

function onWindowResize() {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    labelRenderer.setSize(window.innerWidth, window.innerHeight);
}
    </script>
</body>
</html>
    `;
}