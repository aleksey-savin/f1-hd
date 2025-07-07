import { useState } from "react";
import { useFetcher } from "react-router";

import Form from "react-bootstrap/Form";
import Button from "react-bootstrap/Button";

import Row from "react-bootstrap/Row";
import Col from "react-bootstrap/Col";
import Image from "react-bootstrap/Image";

import { RiSaveLine } from "react-icons/ri";

import AlertToast from "../../../UI/AlertToast";

import PhoneInput from "../../../UI/PhoneInput";
import ImageUpload from "../ImageUpload";

const Profile = ({ user }) => {
  const fetcher = useFetcher();
  const [showMessage, setShowMessage] = useState(false);

  const [phoneNumber, setPhoneNumber] = useState(user.phone);

  const submitHandler = () => {
    fetcher.submit(fetcher.formData, {
      method: "post",
      action: "/my-account",
    });

    setShowMessage(true);
  };

  const [lastName, setLastname] = useState(user.lastName || "");

  const lastNameChangeHandler = (event) => {
    setLastname(event.target.value);
  };

  const [email, setEmail] = useState(user.email || "");

  const emailChangeHandler = (event) => {
    setEmail(event.target.value);
  };

  const [profileImage, setProfileImage] = useState(
    user.profileImagePath
      ? `${import.meta.env.VITE_API_ADDRESS}/uploads/${user.profileImagePath}`
      : "/profilepic-placeholder.jpg",
  );

  return (
    <>
      <Row className="mb-3">
        <Col xs="5" sm="auto" className="mb-3 flex-shrink-1">
          <Image
            src={profileImage}
            style={{ maxHeight: "15rem" }}
            roundedCircle
          />
        </Col>
      </Row>
      <Row className="mb-3">
        <Col>
          <ImageUpload
            userId={user._id.toString()}
            setProfileImage={setProfileImage}
          />
        </Col>
      </Row>
      <fetcher.Form method="post" onSubmit={submitHandler}>
        <Form.Group className="mb-3">
          <Form.Control hidden={true} name="id" defaultValue={user._id} />
          <Form.Label htmlFor="firstName">Имя</Form.Label>
          <Form.Control
            required
            autoFocus
            id="firstName"
            name="firstName"
            type="text"
            defaultValue={user.firstName}
          />
        </Form.Group>
        <Form.Group className="mb-3">
          <Form.Label htmlFor="lastName">Фамилия</Form.Label>
          <Form.Control
            required
            id="lastName"
            name="lastName"
            type="text"
            value={lastName}
            onChange={lastNameChangeHandler}
          />
        </Form.Group>
        <Form.Group className="mb-3">
          <Form.Label htmlFor="email">Email</Form.Label>
          <Form.Control
            required
            id="email"
            name="email"
            type="email"
            value={email}
            onChange={emailChangeHandler}
          />
        </Form.Group>
        <Form.Group className="mb-3">
          <Form.Label htmlFor="phone">Телефон</Form.Label>
          <PhoneInput
            id="phone"
            name="phone"
            setValue={setPhoneNumber}
            value={phoneNumber}
          />
        </Form.Group>
        <Form.Group className="mb-3">
          <Form.Label htmlFor="position">Должность</Form.Label>
          <Form.Control
            id="position"
            name="position"
            type="text"
            defaultValue={user.position}
          />
        </Form.Group>
        <Button
          variant="primary"
          type="submit"
          name="intent"
          value="profile-update"
        >
          <RiSaveLine /> Сохранить
        </Button>
      </fetcher.Form>
      {fetcher.data?.message && (
        <>
          <AlertToast
            show={showMessage}
            setShow={setShowMessage}
            variant={fetcher.data.error ? "danger" : "success"}
            message={fetcher.data.message}
          />
        </>
      )}
    </>
  );
};

export default Profile;
