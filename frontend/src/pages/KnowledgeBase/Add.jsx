import { setDocTitle } from "@/hooks/use-doc-title";
import NoteView from "../../components/KnowledgeBase/NoteView";

const AddKnowledgeNotePage = () => {
  // Новая заметка открывается сразу в режиме редактирования (пустая заметка).
  // Опции связей (form-data) NoteView подгружает сам.
  return <NoteView mode="edit" />;
};

export default AddKnowledgeNotePage;

export async function loader() {
  setDocTitle("Новая заметка");
  return null;
}
