import { ShaderChunk } from 'three';

/**
 * Fog in layers, on top of the scene's exponential fog: everything high up in the city
 * fades into the low rain cloud (towers lose their tops above ~60 m), and the air at street
 * level is a little thicker than the fog alone (distant things near the camera's height go
 * hazy first). It lives in three's fog chunks, so every fogged material gets it; it only
 * applies to the city (far out along +x, see CITY_ORIGIN), and its strength follows the fog
 * density, so it thins out with the fog at dawn. Imported once by Scene before anything
 * compiles.
 */
const PATCHED = '/* cloud-layer */';

if (!ShaderChunk.fog_fragment.includes(PATCHED)) {
  ShaderChunk.fog_pars_vertex = ShaderChunk.fog_pars_vertex.replace(
    'varying float vFogDepth;',
    'varying float vFogDepth;\n\tvarying vec3 vFogWorld;',
  );
  ShaderChunk.fog_vertex = ShaderChunk.fog_vertex.replace(
    'vFogDepth = - mvPosition.z;',
    `vFogDepth = - mvPosition.z;
	vec4 fogWP = vec4( position, 1.0 );
	#ifdef USE_INSTANCING
		fogWP = instanceMatrix * fogWP;
	#endif
	vFogWorld = ( modelMatrix * fogWP ).xyz;`,
  );
  ShaderChunk.fog_pars_fragment = ShaderChunk.fog_pars_fragment.replace(
    'varying float vFogDepth;',
    'varying float vFogDepth;\n\tvarying vec3 vFogWorld;',
  );
  ShaderChunk.fog_fragment = ShaderChunk.fog_fragment.replace(
    'gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );',
    `${PATCHED}
	#ifdef FOG_EXP2
		float cloudLayer = step( 3000.0, vFogWorld.x ) * smoothstep( 58.0, 150.0, vFogWorld.y ) * clamp( fogDensity * 85.0, 0.0, 0.9 );
		// low haze: the air at street level is thicker than the fog alone (aerial layers),
		// strongest for distant things near the camera's own height
		float low = exp( - max( vFogWorld.y - cameraPosition.y + 3.0, 0.0 ) / 14.0 );
		float lowHaze = low * ( 1.0 - exp( - vFogDepth * fogDensity * 0.85 ) ) * 0.5;
		fogFactor = 1.0 - ( 1.0 - fogFactor ) * ( 1.0 - cloudLayer ) * ( 1.0 - lowHaze );
	#endif
	gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );`,
  );
}
