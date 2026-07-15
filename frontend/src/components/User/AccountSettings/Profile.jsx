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
      <div className="tw:p-5">
        <div className="tw:mb-5 tw:flex tw:flex-wrap tw:items-center tw:gap-4">
          {profileImage ? (
            // span с background-image, а не <img>: глобальный автоскейл
            // картинок тикетов (index.css) перебивает размеры <img>
            <span
              role="img"
              aria-label="Фото профиля"
              style={{ backgroundImage: `url("${profileImage}")` }}
              className="tw:size-16 tw:flex-none tw:rounded-full tw:bg-cover tw:bg-center"
            />
          ) : (
            <span
              aria-hidden
              className="tw:grid tw:size-16 tw:flex-none tw:place-items-center tw:rounded-full tw:bg-accent tw:text-xl tw:font-semibold tw:text-muted-foreground tw:inset-ring tw:inset-ring-border"
            >
              {initials}
            </span>
          )}
          <div className="tw:min-w-0">
            <div className="tw:text-xl tw:leading-snug tw:font-semibold tw:tracking-tight">
              {user.firstName} {user.lastName}
            </div>
            <div className="tw:text-sm tw:text-muted-foreground">
              {roleLabel}
              {user.company?.alias ? ` · ${user.company.alias}` : ""}
            </div>
          </div>
          <div className="tw:ms-auto tw:max-md:ms-0 tw:max-md:w-full">
            <ImageUpload
              userId={user._id.toString()}
              setProfileImage={setProfileImage}
            />
          </div>
        </div>

        <input type="hidden" name="id" value={user._id} />
        <div className="tw:grid tw:gap-x-4 tw:md:grid-cols-2">
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
        <Field label="Должность" htmlFor="position" className="tw:mb-1">
          <Input
            id="position"
            name="position"
            type="text"
            defaultValue={user.position}
          />
        </Field>
      </div>
      <div className="tw:flex tw:justify-end tw:border-t tw:border-border-soft tw:px-5 tw:py-3">
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
