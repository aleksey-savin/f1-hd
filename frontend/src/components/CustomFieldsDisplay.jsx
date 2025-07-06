import React from "react";
import { Card, Row, Col, Table } from "react-bootstrap";

const CustomFieldsDisplay = ({ customFields }) => {
  if (!customFields || customFields.length === 0) {
    return null;
  }

  return (
    <Card className="my-3">
      <Card.Body>
        <Card.Title>Расширенная информация</Card.Title>
        <Row>
          <Col sm={6}>
            <h6>
              <Table>
                <tbody>
                  {customFields.map((field, index) => (
                    <tr key={index}>
                      <th>{field.name}</th>
                      <td>
                        {Array.isArray(field.value) ? (
                          <ul className="mb-0 ps-3">
                            {field.value.map((item, i) => (
                              <li className="m-0 p-0" key={i}>
                                {item}
                              </li>
                            ))}
                          </ul>
                        ) : (
                          field.value
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </h6>
          </Col>
        </Row>
      </Card.Body>
    </Card>
  );
};

export default CustomFieldsDisplay;
