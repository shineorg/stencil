import { WorkerBuildContext, CompilerConfig, Logger, ModuleFileMeta, StencilSystem, CompileResults, Diagnostic } from './interfaces';
import { createModuleFileMeta, getFileMeta } from './util';
import { componentClass } from './transformers/component-class';
import { jsxToVNode } from './transformers/jsx-to-vnode';
import { removeImports } from './transformers/remove-imports';
import { updateLifecycleMethods } from './transformers/update-lifecycle-methods';
import * as ts from 'typescript';


export function transpile(sys: StencilSystem, logger: Logger, ctx: WorkerBuildContext, compilerConfig: CompilerConfig, tsFileName: string) {
  logger.debug(`transpile: ${tsFileName}`);

  return getFileMeta(sys, ctx, tsFileName).then(moduleFile => {
    return transpileFile(sys, logger, ctx, compilerConfig, moduleFile);
  });
}


function transpileFile(sys: StencilSystem, logger: Logger, ctx: WorkerBuildContext, compilerConfig: CompilerConfig, moduleFile: ModuleFileMeta) {
  const tsCompilerOptions = createTsCompilerConfigs(compilerConfig);

  const compileResults: CompileResults = {
    jsFiles: {}
  };

  const tsHost: ts.CompilerHost = {
    getSourceFile: (filePath) => ts.createSourceFile(filePath, moduleFile.srcText, ts.ScriptTarget.ES2015),
    getDefaultLibFileName: () => 'lib.d.ts',
    getCurrentDirectory: () => '',
    getDirectories: () => [],
    getCanonicalFileName: (fileName) => fileName,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',

    fileExists: (filePath) => {
      return ctx.moduleFiles.has(filePath);
    },

    readFile: (filePath) => {
      let moduleFile = ctx.moduleFiles.get(filePath);
      if (moduleFile) {
        // already have this file in-memory
        return moduleFile.srcText;
      }

      // file not in-memory yet
      moduleFile = createModuleFileMeta(sys, ctx, filePath, sys.fs.readFileSync(filePath, 'utf-8'));
      moduleFile.recompileOnChange = true;
      return moduleFile.srcText;
    },

    writeFile: (jsFilePath: string, jsText: string, writeByteOrderMark: boolean, onError: any, sourceFiles: ts.SourceFile[]): void => {
      sourceFiles.forEach(s => {
        const moduleFile = ctx.moduleFiles.get(s.fileName);
        if (moduleFile) {
          moduleFile.recompileOnChange = true;
          moduleFile.jsFilePath = jsFilePath;
          moduleFile.jsText = jsText;

          processIncludedStyles(sys, logger, compilerConfig, moduleFile, compileResults);
        }
      });

      compileResults.jsFiles[jsFilePath] = jsText;

      writeByteOrderMark; onError;
    }
  };

  const program = ts.createProgram([moduleFile.filePath], tsCompilerOptions, tsHost);

  const result = program.emit(undefined, tsHost.writeFile, undefined, false, {
    before: [
      componentClass(logger, ctx),
      removeImports(),
      updateLifecycleMethods()
    ],
    after: [
      jsxToVNode(ctx)
    ]
  });

  compileResults.diagnostics = result.diagnostics.map(d => {
    const diagnostic: Diagnostic = {
      msg: d.messageText.toString(),
      level: 'error',
      filePath: d.file && d.file.fileName,
      start: d.start,
      length: d.length,
      category: d.category,
      code: d.code
    };
    return diagnostic;
  });

  return compileResults;
}


function processIncludedStyles(sys: StencilSystem, logger: Logger, compilerConfig: CompilerConfig, moduleFile: ModuleFileMeta, compileResults: CompileResults) {
  if (!moduleFile.isTsSourceFile || !moduleFile.cmpMeta || !moduleFile.cmpMeta.styleMeta) {
    return Promise.resolve(null);
  }

  const destDir = compilerConfig.compilerOptions.outDir;

  logger.debug(`compile, processStyles, destDir ${destDir}`);

  const promises: Promise<any>[] = [];
  compileResults.includedSassFiles = compileResults.includedSassFiles || [];

  const modeNames = Object.keys(moduleFile.cmpMeta.styleMeta);
  modeNames.forEach(modeName => {
    const modeMeta = Object.assign({}, moduleFile.cmpMeta.styleMeta[modeName]);

    if (modeMeta.styleUrls) {
      modeMeta.styleUrls.forEach(styleUrl => {
        const scssFileName = sys.path.basename(styleUrl);
        const scssFilePath = sys.path.join(moduleFile.srcDir, scssFileName);
        promises.push(
          getIncludedSassFiles(sys, logger, compileResults, scssFilePath)
        );
      });
    }

  });

  return Promise.all(promises);
}


function getIncludedSassFiles(sys: StencilSystem, logger: Logger, compileResults: CompileResults, scssFilePath: string) {
  return new Promise(resolve => {

    const sassConfig = {
      file: scssFilePath,
      outFile: `${scssFilePath}.tmp`
    };

    compileResults.includedSassFiles = compileResults.includedSassFiles || [];

    if (compileResults.includedSassFiles.indexOf(scssFilePath) === -1) {
      compileResults.includedSassFiles.push(scssFilePath);
    }

    logger.debug(`compile, getIncludedSassFiles: ${scssFilePath}`);

    sys.sass.render(sassConfig, (err, result) => {
      if (err) {
        logger.error(`sass.render, getIncludedSassFiles, ${err}`);

      } else {
        result.stats.includedFiles.forEach((includedFile: string) => {
          if (compileResults.includedSassFiles.indexOf(includedFile) === -1) {
            compileResults.includedSassFiles.push(includedFile);
          }
        });
      }

      // always resolve
      resolve();
    });

  });
}


function createTsCompilerConfigs(compilerConfig: CompilerConfig) {
  const tsCompilerOptions: ts.CompilerOptions = Object.assign({}, (<any>compilerConfig.compilerOptions));

  tsCompilerOptions.noImplicitUseStrict = true;
  tsCompilerOptions.moduleResolution = ts.ModuleResolutionKind.NodeJs;
  tsCompilerOptions.module = ts.ModuleKind.ES2015;
  tsCompilerOptions.target = getTsScriptTarget(compilerConfig.compilerOptions.target);
  tsCompilerOptions.isolatedModules = true;
  tsCompilerOptions.allowSyntheticDefaultImports = true;
  tsCompilerOptions.allowJs = true;
  tsCompilerOptions.jsx = ts.JsxEmit.React;
  tsCompilerOptions.jsxFactory = 'h';

  tsCompilerOptions.lib = tsCompilerOptions.lib || [];
  if (!tsCompilerOptions.lib.indexOf('lib.dom.d.ts')) {
    tsCompilerOptions.lib.push('lib.dom.d.ts');
  }
  if (!tsCompilerOptions.lib.indexOf('lib.es2015.d.ts')) {
    tsCompilerOptions.lib.push('lib.es2015.d.ts');
  }
  if (!tsCompilerOptions.lib.indexOf('lib.es5.d.ts')) {
    tsCompilerOptions.lib.push('lib.es5.d.ts');
  }

  return tsCompilerOptions;
}


export function getTsScriptTarget(str: 'es5' | 'es2015') {
  if (str === 'es2015') {
    return ts.ScriptTarget.ES2015;
  }

  return ts.ScriptTarget.ES5;
}
