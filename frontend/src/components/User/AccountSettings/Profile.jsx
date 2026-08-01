import { useEffect, useState } from "react";
import { useFetcher } from "react-router";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Field from "@/components/app/Field";
import PhoneInput from "@/components/app/PhoneInput";
import ImageUpload from "../ImageUpload";
import useToastStore from "../../../store/toast-store";

// Секция «Профиль»: hero (аватар · имя · роль + компания · «Сменить фото»)
// и поля учётной записи. Роль и компанию меняет администратор — в hero они
// только отображаются (словарь ролей — как в бургер-меню Navbar).
const Profile = ({ user }) => {
  const fetcher = useFetcher();
  const { showToast } = useToastStore();

  const [phoneNumber, setPhoneNumber] = useState(user.phone);
  const [profileImage, setProfileImage] = useState(
    user.profileImagePath
      ? `${import.meta.env.VITE_API_ADDRESS}/uploads/${user.profileImagePath}`
      : null,
  );

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.message) {
      showToast(
        fetcher.data.error ? "danger" : "success",
        fetcher.data.message,
      );
    }
  }, [fetcher.state, fetcher.data]);

  const roleLabel = user.isAdmin
    ? "Администратор"
    : user.isEndUser
      ? "Пользователь"
      : "Сотрудник";
  const initials =
    `${user.firstName?.[0] ?? ""}${user.lastName?.[0] ?? ""}`.trim() || "?";

  return (
    <fetcher.Form method="post">
      <div className="p-5">
        <div className="mb-5 flex flex-wrap items-center gap-4">
          {profileImage ? (
            // span с background-image, а не <img>: глобальный автоскейл
            // картинок тикетов (index.css) перебивает размеры <img>
            <span
              role="img"
              aria-label="Фото профиля"
              style={{ backgroundImage: `url("${profileImage}")` }}
              className="size-16 flex-none rounded-full bg-cover bg-center"
            />
          ) : (
            <span
              aria-hidden
              className="grid size-16 flex-none place-items-center rounded-full bg-accent text-xl font-semibold text-muted-foreground inset-ring inset-ring-border"
            >
              {initials}
            </span>
          )}
          <div className="min-w-0">
            <div className="text-xl leading-snug font-semibold tracking-tight">
              {user.firstName} {user.lastName}
            </div>
            <div className="text-sm text-muted-foreground">
              {roleLabel}
              {user.company?.alias ? ` · ${user.company.alias}` : ""}
            </div>
          </div>
          <div className="ms-auto max-md:ms-0 max-md:w-full">
            <ImageUpload
              userId={user._id.toString()}
              setProfileImage={setProfileImage}
            />
          </div>
        </div>

        <input type="hidden" name="id" value={user._id} />
        <div className="grid gap-x-4 md:grid-cols-2">
          <Field label="Имя" htmlFor="firstName" required>
            <Input
              required
              id="firstName"
              name="firstName"
              type="text"
              defaultValue={user.firstName}
            />
          </Field>
          <Field label="Фамилия" htmlFor="lastName" required>
            <Input
              required
              id="lastName"
              name="lastName"
              type="text"
              defaultValue={user.lastName}
            />
          </Field>
          <Field label="Email" htmlFor="email" required>
            <Input
              required
              id="email"
              name="email"
              type="email"
              defaultValue={user.email}
            />
          </Field>
          <Field label="Телефон" htmlFor="phone">
            <PhoneInput
              id="phone"
              name="phone"
              value={phoneNumber}
              setValue={setPhoneNumber}
            />
          </Field>
        </div>
        <Field label="Должность" htmlFor="position" className="mb-1">
          <Input
            id="position"
            name="position"
            type="text"
            defaultValue={user.position}
          />
        </Field>
      </div>
      <div className="flex justify-end border-t border-border-soft px-5 py-3">
        <Button
          type="submit"
          name="intent"
          value="profile-update"
          disabled={fetcher.state !== "idle"}
        >
          Сохранить
        </Button>
      </div>
    </fetcher.Form>
  );
};

export default Profile;
