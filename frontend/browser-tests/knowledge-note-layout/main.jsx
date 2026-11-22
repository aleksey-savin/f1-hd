import React from 'react';
import {createRoot} from 'react-dom/client';
import {createMemoryRouter, RouterProvider} from 'react-router';
import '@fontsource-variable/inter';
import './fixture.css';
import '../../src/index.css';
import NoteView from '../../src/components/KnowledgeBase/NoteView';
import {AuthedUserContext} from '../../src/store/authed-user-context';
const cols=Array.from({length:12},(_,i)=>`Column ${i+1}`);
const content=['Обычный текст заметки, который должен оставаться в ширине экрана.',
 'https://example.test/'+ 'long-path-'.repeat(35),
 '|'+cols.join('|')+'|\n|'+cols.map(()=>'---').join('|')+'|\n|'+cols.map((_,i)=>`Value_${i}_`+'wide'.repeat(8)).join('|')+'|',
 '```\n'+ 'long_command --option=value '.repeat(18)+'END_OF_CODE\n```',
 '<img src="/wide.svg" width="1800" alt="Wide diagram">',
 'Последний абзац.'].join('\n\n');
const note={_id:'aaaaaaaaaaaaaaaaaaaaaaaa',title:'Широкая заметка',content,type:'info',companies:[],users:[],categories:[],approved:true};
const mode=new URLSearchParams(location.search).has('edit')?'edit':'read';
const router=createMemoryRouter([{path:'/',element:<AuthedUserContext.Provider value={{statements:{knowledge:['read','manage']}}}><div className="mobile-shell" style={{height:'100dvh'}}><main className="mobile-shell__scroll min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-4"><NoteView note={note} mode={mode}/></main></div></AuthedUserContext.Provider>}]);
createRoot(document.getElementById('root')).render(<RouterProvider router={router}/>);
