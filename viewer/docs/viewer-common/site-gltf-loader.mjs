import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export async function createSiteGLTFLoader(site) {
  const loader = new GLTFLoader();
  if (site?.meshopt) {
    const { MeshoptDecoder } = await import('three/addons/libs/meshopt_decoder.module.js');
    loader.setMeshoptDecoder(MeshoptDecoder);
  }
  return loader;
}
