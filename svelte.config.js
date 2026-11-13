import adapter from '@sveltejs/adapter-static';

export default {
	compilerOptions: { runes: true },
	kit: {
		adapter: adapter(),
		paths: { base: process.env.BASE_PATH || '' }
	}
};
