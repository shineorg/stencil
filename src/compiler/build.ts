import { BuildConfig, Manifest } from '../util/interfaces';
import { BuildResults, BundlerConfig, CompilerConfig, FilesToWrite } from './interfaces';
import { bundle } from './bundle';
import { compile } from './compile';
import { generateDependentManifests, mergeManifests, updateManifestUrls } from './manifest';
import { generateProjectFiles } from './build-project';
import { updateDirectories, writeFiles } from './fs-util';
import { WorkerManager } from './worker-manager';


export function build(buildConfig: BuildConfig) {
  const sys = buildConfig.sys;
  const logger = buildConfig.logger;

  const timeSpan = logger.createTimeSpan(`build, ${buildConfig.isDevMode ? 'dev' : 'prod'} mode, started`);

  buildConfig.writeCompiledToDisk = false;

  const workerManager = new WorkerManager(buildConfig.sys, buildConfig.logger);
  workerManager.connect(buildConfig.numWorkers);

  const buildResults: BuildResults = {
    diagnostics: [],
    manifest: {},
    componentRegistry: []
  };

  const filesToWrite: FilesToWrite = {};

  return Promise.resolve().then(() => {
    // validate our data is good to go
    validateBuildConfig(buildConfig);

    return generateDependentManifests(
      sys,
      logger,
      buildConfig.collections,
      buildConfig.rootDir,
      buildConfig.destDir);

  }).then(dependentManifests => {
    return compileProject(buildConfig, workerManager).then(compileResults => {
      if (compileResults.diagnostics) {
        buildResults.diagnostics = buildResults.diagnostics.concat(compileResults.diagnostics);
      }
      if (compileResults.filesToWrite) {
        Object.assign(filesToWrite, compileResults.filesToWrite);
      }

      const resultsManifest: Manifest = compileResults.manifest || {};

      const localManifest = updateManifestUrls(
        logger,
        sys,
        resultsManifest,
        buildConfig.destDir,
        buildConfig.destDir
      );
      return mergeManifests([].concat((localManifest || []), dependentManifests));
    });

  }).then(manifest => {
    // bundle all of the components into their separate files
    return bundleProject(buildConfig, workerManager, manifest).then(bundleResults => {
      if (bundleResults.diagnostics) {
        buildResults.diagnostics = buildResults.diagnostics.concat(bundleResults.diagnostics);
      }
      if (bundleResults.filesToWrite) {
        Object.assign(filesToWrite, bundleResults.filesToWrite);
      }

      // generate the loader and core files for this project
      return generateProjectFiles(buildConfig, bundleResults.componentRegistry, filesToWrite);
    });

  }).then(() => {
    // write all the files in one go
    if (buildConfig.isDevMode) {
      // only ensure the directories it needs exists and writes the files
      return writeFiles(sys, filesToWrite, buildConfig.destDir);

    } else {
      // first removes any directories and files that aren't in the files to write
      // then ensure the directories it needs exists and writes the files
      return updateDirectories(sys, filesToWrite, buildConfig.destDir);
    }

  }).catch(err => {
    buildResults.diagnostics.push({
      msg: err.toString(),
      type: 'error',
      stack: err.stack
    });

  }).then(() => {
    buildResults.diagnostics.forEach(d => {
      if (d.type === 'error' && logger.level === 'debug' && d.stack) {
        logger.error(d.stack);
      } else {
        logger[d.type](d.msg);
      }
    });

    if (buildConfig.isWatch) {
      timeSpan.finish(`build ready, watching files...`);

    } else {
      workerManager.disconnect();
      timeSpan.finish(`build finished`);
    }

    return buildResults;
  });
}


function compileProject(buildConfig: BuildConfig, workerManager: WorkerManager) {
  const config: CompilerConfig = {
    compilerOptions: {
      outDir: buildConfig.destDir,
      module: 'commonjs',
      target: 'es5',
      rootDir: buildConfig.srcDir
    },
    include: [
      buildConfig.srcDir
    ],
    exclude: [
      'node_modules',
      'test'
    ],
    isDevMode: buildConfig.isDevMode,
    bundles: buildConfig.bundles,
    isWatch: buildConfig.isWatch,
    writeCompiledToDisk: buildConfig.writeCompiledToDisk
  };

  return compile(buildConfig.sys, buildConfig.logger, workerManager, config);
}


function bundleProject(buildConfig: BuildConfig, workerManager: WorkerManager, manifest: Manifest) {
  const bundlerConfig: BundlerConfig = {
    namespace: buildConfig.namespace,
    srcDir: buildConfig.srcDir,
    destDir: buildConfig.destDir,
    manifest: manifest,
    isDevMode: buildConfig.isDevMode,
    isWatch: buildConfig.isWatch
  };

  return bundle(buildConfig.sys, buildConfig.logger, bundlerConfig, workerManager);
}


export function validateBuildConfig(buildConfig: BuildConfig) {
  if (!buildConfig.srcDir) {
    throw `config.srcDir required`;
  }
  if (!buildConfig.sys) {
    throw 'config.sys required';
  }
  if (!buildConfig.sys.fs) {
    throw 'config.sys.fs required';
  }
  if (!buildConfig.sys.path) {
    throw 'config.sys.path required';
  }
  if (!buildConfig.sys.sass) {
    throw 'config.sys.sass required';
  }
  if (!buildConfig.sys.rollup) {
    throw 'config.sys.rollup required';
  }
  if (!buildConfig.sys.typescript) {
    throw 'config.sys.typescript required';
  }

  // ensure we've at least got empty objects
  buildConfig.bundles = buildConfig.bundles || [];
  buildConfig.collections = buildConfig.collections || [];

  // default to "App" namespace if one wasn't provided
  buildConfig.namespace = (buildConfig.namespace || 'App').trim();

  // default to "bundles" directory if one wasn't provided
  buildConfig.namespace = (buildConfig.namespace || 'bundles').trim();
}