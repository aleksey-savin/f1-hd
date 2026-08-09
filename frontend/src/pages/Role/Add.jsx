import RoleForm from "../../components/Role/Form";

const AddRolePage = () => <RoleForm />;

export default AddRolePage;

export function loader() {
  document.title = "Новая роль";
  return null;
}
