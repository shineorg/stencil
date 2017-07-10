import { ModuleFileMeta } from '../../interfaces';
import * as ts from 'typescript';


export function getStateDecoratorMeta(fileMeta: ModuleFileMeta, classNode: ts.ClassDeclaration) {
  fileMeta.cmpMeta.statesMeta = [];

  const decoratedMembers = classNode.members.filter(n => n.decorators && n.decorators.length);

  decoratedMembers.forEach(memberNode => {
    let isState = false;
    let propName: string = null;

    memberNode.forEachChild(n => {
      if (n.kind === ts.SyntaxKind.Decorator && n.getChildCount() > 1) {
        const child = n.getChildAt(1);
        const firstToken = child.getFirstToken();

        // If the first token is @State()
        if (firstToken && firstToken.getText() === 'State') {
          isState = true;

        } else if (!firstToken && child.getText() === 'State') {
          // If the first token is @State
          isState = true;
        }
      } else if (isState) {
        if (n.kind === ts.SyntaxKind.Identifier && !propName) {
          propName = n.getText();
        }
      }
    });

    if (isState && propName) {
      fileMeta.cmpMeta.statesMeta.push(propName);
      memberNode.decorators = undefined;
    }
  });

  fileMeta.cmpMeta.statesMeta = fileMeta.cmpMeta.statesMeta.sort((a, b) => {
    if (a.toLowerCase() < b.toLowerCase()) return -1;
    if (a.toLowerCase() > b.toLowerCase()) return 1;
    return 0;
  });
}