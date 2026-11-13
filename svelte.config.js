import node from '@sveltejs/adapter-node';
import pages from '@sveltejs/adapter-static';

const server = process.env.VITE_LENDTRIAL_SERVER === '1';

export default {
	compilerOptions: { runes: true },
	kit: {
		adapter: server ? node({ out: 'build-server' }) : pages({ strict: false }),
		paths: { base: process.env.BASE_PATH || '' }
	}
};
