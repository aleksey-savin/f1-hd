import { useState, useEffect } from "react";
import { redirect, useLoaderData } from "react-router";

import { RiServerLine } from "react-icons/ri";

import ChecklistsList from "../../components/Checklist/List";

import { getLocalStorageData } from "../../util/auth";

import ListWrapper from "../../UI/ListWrapper";

const Checklists = () => {
  const checklists = useLoaderData();

  const [filteredChecklists, setFilteredChecklists] = useState(checklists);

  const [searchTerm, setSearchTerm] = useState("");

  useEffect(() => {
    setFilteredChecklists(
      checklists.filter((checklist) =>
        checklist.title.toLowerCase().includes(searchTerm.toLowerCase()),
      ),
    );
  }, [searchTerm, checklists]);

  useEffect(() => {
    setFilteredChecklists(checklists);
  }, [checklists]);

  const title = () => {
    return (
      <>
        <RiServerLine /> Чеклисты
      </>
    );
  };

  return (
    <ListWrapper
      title={title}
      filteredList={filteredChecklists}
      setSearchTerm={setSearchTerm}
    >
      <ChecklistsList items={filteredChecklists}></ChecklistsList>
    </ListWrapper>
  );
};

export default Checklists;

export async function loader() {
  document.title = "ЧЕКЛИСТЫ";

  const { token } = getLocalStorageData();

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/checklists`,
    {
      headers: {
        Authorization: "Bearer " + token,
      },
    },
  );

  if (!response.ok) {
    throw response;
  }

  return response;
}

export async function action({ request }) {
  const { token } = getLocalStorageData();

  const data = await request.formData();
  const id = data.get("id");

  const response = await fetch(
    `${import.meta.env.VITE_API_ADDRESS}/api/checklists/delete/${id}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + token,
      },
    },
  );

  if ([409].includes(response.status)) {
    return response;
  }

  if (!response.ok) {
    throw response;
  }

  return redirect("/checklists");
}
