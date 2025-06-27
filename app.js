/* ───────────────────────── IMPORTS ───────────────────────── */
import * as THREE from './libs/three/three.module.js';
import { GLTFLoader } from './libs/three/jsm/GLTFLoader.js';
import { DRACOLoader } from './libs/three/jsm/DRACOLoader.js';
import { RGBELoader } from './libs/three/jsm/RGBELoader.js';
import { Stats } from './libs/stats.module.js';
import { LoadingBar } from './libs/LoadingBar.js';
import { VRButton } from './libs/VRButton.js';
import { CanvasUI } from './libs/CanvasUI.js';
import { GazeController } from './libs/GazeController.js';
import { XRControllerModelFactory } from './libs/three/jsm/XRControllerModelFactory.js';

class App {
	constructor() {
		/* ── DOM / renderer setup ── */
		const container = document.createElement('div');
		document.body.appendChild(container);

		this.assetsPath = './assets/';

		this.camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 500);
		this.camera.position.set(0, 1.6, 0);

		this.dolly = new THREE.Object3D();
		this.dolly.position.set(0, 0, 10);
		this.dolly.add(this.camera);
		this.dummyCam = new THREE.Object3D();
		this.camera.add(this.dummyCam);

		this.scene = new THREE.Scene();
		this.scene.add(this.dolly);

		/* ───── WARM LIGHTS ───── */
		const hemi = new THREE.HemisphereLight(0xffeeb1, 0xffcc88, 0.9); // warm sky & ground
		this.scene.add(hemi);

		const sun = new THREE.DirectionalLight(0xfff0b3, 0.6);           // soft sunlight
		sun.position.set(5, 10, 2);
		this.scene.add(sun);

		/* ── renderer ── */
		this.renderer = new THREE.WebGLRenderer({ antialias: true });
		this.renderer.setPixelRatio(window.devicePixelRatio);
		this.renderer.setSize(window.innerWidth, window.innerHeight);
		this.renderer.outputEncoding = THREE.sRGBEncoding;
		container.appendChild(this.renderer.domElement);

		this.setEnvironment();
		window.addEventListener('resize', this.resize.bind(this));

		/* ── helpers ── */
		this.clock = new THREE.Clock();
		this.up = new THREE.Vector3(0, 1, 0);
		this.origin = new THREE.Vector3();
		this.workingVec3 = new THREE.Vector3();
		this.workingQuaternion = new THREE.Quaternion();
		this.raycaster = new THREE.Raycaster();

		this.stats = new Stats();
		container.appendChild(this.stats.dom);

		this.loadingBar = new LoadingBar();
		this.loadCollege();

		/* ── audio ── */
		this.listener = new THREE.AudioListener();
		this.camera.add(this.listener);
		this.audioLoader = new THREE.AudioLoader();

		// ambient loop
		this.ambientSound = new THREE.Audio(this.listener);
		this.audioLoader.load('./assets/sound/ambient.mp3', (buf) => {
			this.ambientSound.setBuffer(buf);
			this.ambientSound.setLoop(true);
			this.ambientSound.setVolume(0.5);
			this.ambientSound.play();
		});

		// footsteps
		this.footstepSound = new THREE.Audio(this.listener);
		this.audioLoader.load('./assets/sound/footstep.mp3', (buf) => {
			this.footstepSound.setBuffer(buf);
			this.footstepSound.setLoop(false);
			this.footstepSound.setVolume(1.0);
		});
		this.stepCooldown = 0.4;
		this.lastStepTime = 0;

		this.immersive = false;

		fetch('./college.json')
			.then((res) => res.json())
			.then((data) => {
				this.boardShown = '';
				this.boardData = data;
			});
	}

	/* ───────────────── Environment ───────────────── */
	setEnvironment() {
		const hdrLoader = new RGBELoader().setDataType(THREE.UnsignedByteType);
		const pmrem = new THREE.PMREMGenerator(this.renderer);
		pmrem.compileEquirectangularShader();

		hdrLoader.load('./assets/hdr/venice_sunset_1k.hdr', (tex) => {
			this.scene.environment = pmrem.fromEquirectangular(tex).texture;
			pmrem.dispose();
		});
	}

	resize() {
		this.camera.aspect = window.innerWidth / window.innerHeight;
		this.camera.updateProjectionMatrix();
		this.renderer.setSize(window.innerWidth, window.innerHeight);
	}

	/* ───────────────── Load GLB & recolor ───────────────── */
	loadCollege() {
		const loader = new GLTFLoader().setPath(this.assetsPath);
		loader.setDRACOLoader(new DRACOLoader().setDecoderPath('./libs/three/js/draco/'));

		loader.load(
			'college.glb',
			(gltf) => {
				const college = gltf.scene.children[0];
				this.scene.add(college);

				college.traverse((child) => {
					if (!child.isMesh) return;

					const matName = child.material.name;

					if (child.name.includes('PROXY')) {
						child.material.visible = false;
						this.proxy = child;
					} else if (matName.includes('Glass')) {
						child.material.opacity = 0.1;
						child.material.transparent = true;
					} else if (matName.includes('Wall')) {
						child.material.color.setHex(0x8B4513);
					} else if (matName.includes('Stair')) {
						child.material.color.setHex(0x000000);
					} else if (matName.includes('Sofa')) {
						child.material.color.setStyle('#F5F5DC');
					} else if (matName.includes('Carpet')) {
						child.material.color.setHex(0xB22222);
					} else if (matName.includes('Door') || child.name.includes('Door')) {
						child.material.color.setHex(0xFF0000);
					} else if (matName.includes('Floor') || child.name.includes('Floor')) {
						child.material.color.setHex(0xFFD580);
					} else if (matName.includes('Ceiling') || child.name.includes('Ceiling')) {
						child.material.color.setHex(0x000000);
					} else if (matName.includes('SkyBox')) {
						const oldMat = child.material;
						child.material = new THREE.MeshBasicMaterial({ map: oldMat.map });
						oldMat.dispose();
					}
				});

				// dummy info-board locator
				const d1 = college.getObjectByName('LobbyShop_Door__1_');
				const d2 = college.getObjectByName('LobbyShop_Door__2_');
				if (d1 && d2) {
					const p = d1.position.clone().sub(d2.position).multiplyScalar(0.5).add(d2.position);
					const lobby = new THREE.Object3D();
					lobby.name = 'LobbyShop';
					lobby.position.copy(p);
					college.add(lobby);
				}

				this.loadingBar.visible = false;
				this.setupXR();
			},
			(xhr) => (this.loadingBar.progress = xhr.loaded / xhr.total),
			(err) => console.error('Error loading college:', err)
		);
	}

	/* ───────────────── XR Setup ───────────────── */
	setupXR() {
		this.renderer.xr.enabled = true;
		new VRButton(this.renderer);

		this.controllers = this.buildControllers(this.dolly);

		const timeoutId = setTimeout(() => {
			this.useGaze = true;
			this.gazeController = new GazeController(this.scene, this.dummyCam);
		}, 2000);

		this.controllers.forEach((c) => {
			c.addEventListener('selectstart', () => (c.userData.selectPressed = true));
			c.addEventListener('selectend', () => (c.userData.selectPressed = false));
			c.addEventListener('connected', () => clearTimeout(timeoutId));
		});

		const cfg = {
			panelSize: { height: 0.5 },
			height: 256,
			name: { fontSize: 50, height: 70 },
			info: { position: { top: 70, backgroundColor: '#ccc', fontColor: '#000' } }
		};
		this.ui = new CanvasUI({ name: 'name', info: 'info' }, cfg);
		this.scene.add(this.ui.mesh);

		this.renderer.setAnimationLoop(this.render.bind(this));
	}

	buildControllers(parent) {
		const factory = new XRControllerModelFactory();
		const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, 0, -1)]);
		const line = new THREE.Line(geo);
		line.scale.z = 0;

		const ctrls = [];
		for (let i = 0; i < 2; i++) {
			const c = this.renderer.xr.getController(i);
			c.add(line.clone());
			c.userData.selectPressed = false;
			parent.add(c);
			ctrls.push(c);

			const g = this.renderer.xr.getControllerGrip(i);
			g.add(factory.createControllerModel(g));
			parent.add(g);
		}
		return ctrls;
	}

	/* ───────────────── Movement ───────────────── */
	moveDolly(dt) {
		if (!this.proxy) return;

		const wallLimit = 1.3, speed = 2;
		let pos = this.dolly.position.clone();
		pos.y += 1;

		const prevQ = this.dolly.quaternion.clone();
		this.dolly.quaternion.copy(this.dummyCam.getWorldQuaternion(this.workingQuaternion));

		let dir = new THREE.Vector3();
		this.dolly.getWorldDirection(dir).negate();
		this.raycaster.set(pos, dir);

		const hit = this.raycaster.intersectObject(this.proxy);
		if (!(hit.length && hit[0].distance < wallLimit)) {
			this.dolly.translateZ(-dt * speed);
			const now = this.clock.elapsedTime;
			if (!this.footstepSound.isPlaying && now - this.lastStepTime > this.stepCooldown) {
				this.footstepSound.play();
				this.lastStepTime = now;
			}
			pos = this.dolly.getWorldPosition(this.origin);
		}

		// side collisions
		dir.set(-1, 0, 0).applyMatrix4(this.dolly.matrix).normalize();
		this.raycaster.set(pos, dir);
		let ix = this.raycaster.intersectObject(this.proxy);
		if (ix.length && ix[0].distance < wallLimit) this.dolly.translateX(wallLimit - ix[0].distance);

		dir.set(1, 0, 0).applyMatrix4(this.dolly.matrix).normalize();
		this.raycaster.set(pos, dir);
		ix = this.raycaster.intersectObject(this.proxy);
		if (ix.length && ix[0].distance < wallLimit) this.dolly.translateX(ix[0].distance - wallLimit);

		// floor collision
		dir.set(0, -1, 0);
		pos.y += 1.5;
		this.raycaster.set(pos, dir);
		ix = this.raycaster.intersectObject(this.proxy);
		if (ix.length) this.dolly.position.copy(ix[0].point);

		this.dolly.quaternion.copy(prevQ);
	}

	get selectPressed() {
		return this.controllers?.some((c) => c.userData.selectPressed);
	}

	/* ───────────────── UI ───────────────── */
	showInfoboard(name, info, pos) {
		if (!this.ui) return;
		this.ui.position.copy(pos).add(this.workingVec3.set(0, 1.3, 0));
		this.ui.lookAt(this.dummyCam.getWorldPosition(this.workingVec3));
		this.ui.updateElement('name', info.name);
		this.ui.updateElement('info', info.info);
		this.ui.update();
		this.ui.visible = true;
		this.boardShown = name;
	}

	/* ───────────────── Render Loop ───────────────── */
	render() {
		const dt = this.clock.getDelta();

		if (this.renderer.xr.isPresenting) {
			const moveGaze = this.useGaze && this.gazeController?.mode === GazeController.Modes.MOVE;
			if (this.selectPressed || moveGaze) this.moveDolly(dt);

			if (this.boardData) {
				const dollyPos = this.dolly.getWorldPosition(new THREE.Vector3());
				let found = false;
				for (const [name, info] of Object.entries(this.boardData)) {
					const obj = this.scene.getObjectByName(name);
					if (!obj) continue;
					if (dollyPos.distanceTo(obj.getWorldPosition(new THREE.Vector3())) < 3) {
						found = true;
						if (this.boardShown !== name) this.showInfoboard(name, info, obj.position);
					}
				}
				if (!found) {
					this.boardShown = '';
					this.ui.visible = false;
				}
			}
		}

		if (this.immersive !== this.renderer.xr.isPresenting) {
			this.resize();
			this.immersive = this.renderer.xr.isPresenting;
		}

		this.stats.update();
		this.renderer.render(this.scene, this.camera);
	}
}

export { App };
