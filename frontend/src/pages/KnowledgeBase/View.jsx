import { useLoaderData } from "react-router";

import NoteView from "../../components/KnowledgeBase/NoteView";
import { getLocalStorageData } from "../../util/auth";

const ViewKnowledgeNote = () => {
  const note = useLoaderData();
  // key по id — чтобы при переходе между заметками компонент перемонтировался
  // и сбрасывал внутреннее состояние (режим/поля)
  return <NoteView key={note._id} note={note} mode="read" />;
};

export default ViewKnowledgeNote;

export async function loader({ params }) {
  const { token } = getLocalStorageData();
  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/knowledge-notes/${params.id}`,
    {
      headers: { Authorization: "Bearer " + token },
    },
  );

  if (!response.ok) {
    throw response;
  }

  const note = await response.json();
  document.title = `F1 HD | ${note.title}`;
  return note;
}
